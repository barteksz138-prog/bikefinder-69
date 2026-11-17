import handler from "./.build/gem.mjs";
import assert from "node:assert/strict";
const calls = [];
let nextResp;
const IMG = "https://img.kleinanzeigen.de/api/v1/prod-ads/images/ab/12345678-1234-1234-1234-123456789abc?rule=$_59.JPG";
global.fetch = async (url, opts = {}) => {
  calls.push({ url, opts });
  if (url.startsWith("https://img.")) {
    return { ok: true, headers: new Map([["content-type", "image/jpeg"], ["content-length", "4"]]), arrayBuffer: async () => new Uint8Array([1,2,3,4]).buffer };
  }
  return nextResp();
};
const mkRes = () => { const r = { code: 0, body: null, headers: {} }; r.setHeader = (k, v) => r.headers[k] = v; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; return r; };
const okResp = (body, status = 200, hdrs = {}) => () => ({ ok: status < 400, status, headers: { get: (k) => hdrs[k.toLowerCase()] ?? null }, json: async () => body });

// 1. Claude success with cache prefix + images + effort
nextResp = okResp({ model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: "{\"decyzja\":\"nie\"}" }],
  usage: { input_tokens: 1000, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0, output_tokens: 300 } });
let res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "sk-ant-x", imageUrls: [IMG],
  messages: [{ role: "user", parts: [{ text: "STATIC", cacheControl: true }, { text: "DYN" }] }],
  generationConfig: { temperature: 0.3, maxOutputTokens: 600, responseMimeType: "application/json", claudeEffort: "low" } } }, res);
assert.equal(res.code, 200);
const req = calls.find(c => c.url.includes("anthropic"));
assert.equal(req.opts.headers["x-api-key"], "sk-ant-x");
assert.equal(req.opts.headers["anthropic-version"], "2023-06-01");
const b = JSON.parse(req.opts.body);
assert.equal(b.model, "claude-haiku-5-5");
assert.deepEqual(b.output_config, { effort: "low" });
assert.deepEqual(b.thinking, { type: "adaptive" });
assert.equal(b.max_tokens, 8000);
assert.ok(!("temperature" in b));
const c = b.messages[0].content;
// kolejność: stała część (cache) → zdjęcia → dane ogłoszenia
assert.deepEqual(c[0], { type: "text", text: "STATIC", cache_control: { type: "ephemeral", ttl: "1h" } });
assert.equal(c[1].type, "image"); assert.equal(c[1].source.media_type, "image/jpeg"); assert.equal(c[1].source.data, Buffer.from([1,2,3,4]).toString("base64"));
assert.deepEqual(c[2], { type: "text", text: "DYN" });
assert.equal(res.body.candidates[0].content.parts[0].text, "{\"decyzja\":\"nie\"}");
assert.equal(res.body.candidates[0].finishReason, "STOP");
assert.deepEqual(res.body.usageMetadata, { promptTokenCount: 6000, cachedContentTokenCount: 5000, cacheWriteTokenCount: 0, candidatesTokenCount: 300, thoughtsTokenCount: 0 });
assert.equal(res.body.imagesAttached, 1);

// 2. max_tokens → MAX_TOKENS; chat roles; effort from thinkingBudget; big max
calls.length = 0;
nextResp = okResp({ stop_reason: "max_tokens", content: [], usage: { input_tokens: 10, output_tokens: 8000, cache_creation_input_tokens: 7000 } });
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "k",
  messages: [{ role: "user", parts: [{ text: "a" }] }, { role: "model", parts: [{ text: "b" }] }, { role: "user", parts: [{ text: "c" }] }],
  generationConfig: { thinkingBudget: 16384, maxOutputTokens: 50000 } } }, res);
const b2 = JSON.parse(calls[0].opts.body);
assert.deepEqual(b2.messages.map(m => m.role), ["user", "assistant", "user"]);
assert.equal(b2.output_config.effort, "high"); assert.equal(b2.max_tokens, 50000);
assert.equal(res.body.candidates[0].finishReason, "MAX_TOKENS");
assert.equal(res.body.usageMetadata.cacheWriteTokenCount, 7000);
assert.equal(res.body.usageMetadata.promptTokenCount, 7010);

// 3. error 429 with retry-after
nextResp = okResp({ type: "error", error: { type: "rate_limit_error", message: "Number of requests has exceeded your rate limit" } }, 429, { "retry-after": "12" });
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "k", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 429);
assert.match(res.body.error.message, /429 rate_limit_error.*retry in 12s/);
// default effort medium (chat)
assert.equal(JSON.parse(calls.at(-1).opts.body).output_config.effort, "medium");

// 4. bad model rejected
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "../evil", apiKey: "k", messages: [] } }, res);
assert.equal(res.code, 400);

// 5. Gemini branch strips cacheControl
calls.length = 0;
nextResp = okResp({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
res = mkRes();
await handler({ method: "POST", body: { provider: "gemini", model: "gemini-2.5-flash", apiKey: "k", messages: [{ role: "user", parts: [{ text: "S", cacheControl: true }, { text: "D" }] }] } }, res);
const gb = JSON.parse(calls[0].opts.body);
assert.deepEqual(gb.contents[0].parts, [{ text: "S" }, { text: "D" }]);
calls.length = 0;
res = mkRes();
await handler({ method: "POST", body: { provider: "gemini", model: "gemini-2.5-flash", apiKey: "k", imageUrls: [IMG], messages: [{ role: "user", parts: [{ text: "S", cacheControl: true }, { text: "D" }] }] } }, res);
const gb2 = JSON.parse(calls.find(c => c.url.includes("generativelanguage")).opts.body);
// v6.11: klucz Gemini w nagłówku, nie w adresie
{ const gc = calls.find(c => c.url.includes("generativelanguage")); assert.ok(!gc.url.includes("key="), "klucz nie w URL"); assert.equal(gc.opts.headers["x-goog-api-key"], "k"); }
assert.equal(gb2.contents[0].parts[0].text, "S"); assert.ok(gb2.contents[0].parts[1].inlineData); assert.equal(gb2.contents[0].parts[2].text, "D");
assert.ok(!("cacheControl" in gb2.contents[0].parts[0]));
// bez znacznika cache — zdjęcia na początku (jak wcześniej)
calls.length = 0; res = mkRes();
await handler({ method: "POST", body: { provider: "gemini", model: "gemini-2.5-flash", apiKey: "k", imageUrls: [IMG], messages: [{ role: "user", parts: [{ text: "ALL" }] }] } }, res);
const gb3 = JSON.parse(calls.find(c => c.url.includes("generativelanguage")).opts.body);
assert.ok(gb3.contents[0].parts[0].inlineData); assert.equal(gb3.contents[0].parts[1].text, "ALL");

// 6. v6.20: pośrednik Freemodel — ten sam format Anthropic, adres claude-n-codex.com:8443; nieznany pośrednik odrzucony
calls.length = 0;
nextResp = okResp({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], usage: { input_tokens: 5, output_tokens: 3 } });
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-myapi_x", relay: "freemodel", messages: [{ role: "user", parts: [{ text: "x" }] }], generationConfig: { claudeEffort: "high" } } }, res);
assert.equal(res.code, 200);
assert.equal(calls[0].url, "https://claude-n-codex.com:8443/v1/messages");
assert.equal(calls[0].opts.headers["x-api-key"], "sk-myapi_x");
assert.equal(JSON.parse(calls[0].opts.body).output_config.effort, "high");
calls.length = 0; res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "k", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages", "bez relay — Anthropic");
nextResp = okResp({ type: "error", error: { type: "billing_error", message: "insufficient balance" } }, 402);
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "k", relay: "freemodel", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 402); assert.match(res.body.error.message, /^Freemodel HTTP 402/);
calls.length = 0; res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "k", relay: "https://evil.example", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 400); assert.equal(calls.length, 0, "nieznany pośrednik — bez zapytania");
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "k", relay: "__proto__", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 400);
console.log("API TESTS OK");
