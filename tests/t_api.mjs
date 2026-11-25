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

// 7. v6.21: GPT przez Freemodel — format OpenAI, zdjęcia jako data URL (za stałą częścią), mapowanie odpowiedzi na Gemini
calls.length = 0;
nextResp = okResp({ model: "gpt-6.1-terra", choices: [{ index: 0, message: { role: "assistant", content: "{\"decyzja\":\"nie\"}" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 3051, completion_tokens: 247, prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 2497 } } });
res = mkRes();
await handler({ method: "POST", body: { provider: "freemodel-gpt", model: "gpt-6.1-terra", apiKey: "sk-myapi_g", imageUrls: [IMG],
  messages: [{ role: "user", parts: [{ text: "STATIC", cacheControl: true }, { text: "DYN" }] }],
  generationConfig: { temperature: 0.3, maxOutputTokens: 600, responseMimeType: "application/json", reasoningEffort: "medium" } } }, res);
assert.equal(res.code, 200);
const g7 = calls.find(c => c.url === "https://claude-n-codex.com:8443/v1/chat/completions");
assert.ok(g7, "zapytanie do Freemodel /v1/chat/completions");
assert.equal(g7.opts.headers["Authorization"], "Bearer sk-myapi_g");
const gb7 = JSON.parse(g7.opts.body);
assert.equal(gb7.model, "gpt-6.1-terra"); assert.equal(gb7.reasoning_effort, "medium"); assert.equal(gb7.max_completion_tokens, 16000);
assert.deepEqual(gb7.response_format, { type: "json_object" }); assert.ok(!("temperature" in gb));
const gc7 = gb7.messages[0].content;
assert.deepEqual(gc7[0], { type: "text", text: "STATIC" });
assert.equal(gc7[1].type, "image_url"); assert.equal(gc7[1].image_url.url, "data:image/jpeg;base64," + Buffer.from([1,2,3,4]).toString("base64"));
assert.deepEqual(gc7[2], { type: "text", text: "DYN" });
assert.equal(res.body.candidates[0].content.parts[0].text, "{\"decyzja\":\"nie\"}");
assert.equal(res.body.candidates[0].finishReason, "STOP");
assert.equal(res.body.imagesAttached, 1);
assert.deepEqual(res.body.usageMetadata, { promptTokenCount: 3051, cachedContentTokenCount: 100, cacheWriteTokenCount: 2497, candidatesTokenCount: 247, thoughtsTokenCount: 0 });
// ucięta odpowiedź → MAX_TOKENS (frontend ponawia z większym limitem)
nextResp = okResp({ choices: [{ message: { content: "{" }, finish_reason: "length" }], usage: {} });
res = mkRes();
await handler({ method: "POST", body: { provider: "freemodel-gpt", model: "gpt-6.1-terra", apiKey: "k", messages: [{ role: "user", parts: [{ text: "x" }] }], generationConfig: {} } }, res);
assert.equal(res.body.candidates[0].finishReason, "MAX_TOKENS");
// błąd Freemodel → komunikat z kodem HTTP (frontend przełącza wtedy na Haiku)
nextResp = okResp({ error: { message: "insufficient balance", type: "billing_error" } }, 402);
res = mkRes();
await handler({ method: "POST", body: { provider: "freemodel-gpt", model: "gpt-6.1-terra", apiKey: "k", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 402); assert.match(res.body.error.message, /^Freemodel HTTP 402 billing_error: insufficient balance/);
// niepoprawny model — bez zapytania
calls.length = 0; res = mkRes();
await handler({ method: "POST", body: { provider: "freemodel-gpt", model: "claude-haiku-5-5", apiKey: "k", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 400); assert.equal(calls.length, 0);

// 8. v6.24: pośrednik ApiDuck — format Anthropic na apiduck.servepics.com/v1/messages, klucz jako Bearer (i x-api-key)
calls.length = 0;
nextResp = okResp({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], usage: { input_tokens: 7, output_tokens: 2 } });
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "duck_k", relay: "apiduck", imageUrls: [IMG],
  messages: [{ role: "user", parts: [{ text: "STATIC", cacheControl: true }, { text: "DYN" }] }], generationConfig: { claudeEffort: "low" } } }, res);
assert.equal(res.code, 200);
const d8 = calls.find(c => c.url.startsWith("https://apiduck."));
assert.equal(d8.url, "https://apiduck.servepics.com/v1/messages");
assert.equal(d8.opts.headers["Authorization"], "Bearer duck_k"); assert.equal(d8.opts.headers["x-api-key"], "duck_k");
assert.equal(d8.opts.headers["anthropic-version"], "2023-06-01");
{ const db = JSON.parse(d8.opts.body); assert.equal(db.model, "claude-haiku-5-5"); assert.equal(db.messages[0].content[1].type, "image"); }
assert.equal(res.body.imagesAttached, 1);
// Anthropic i Freemodel bez nagłówka Authorization (jak dotąd)
calls.length = 0; res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "k", relay: "freemodel", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.ok(!("Authorization" in calls[0].opts.headers), "Freemodel bez Bearer");
// błąd w innym kształcie ({ error: "tekst" }) → komunikat z nazwą pośrednika i kodem HTTP
nextResp = okResp({ error: "invalid api key" }, 401);
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "k", relay: "apiduck", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 401); assert.match(res.body.error.message, /^ApiDuck HTTP 401 .*invalid api key/);
// 200 bez treści (np. strona błędu) → 502, żeby frontend przeszedł do zapasu
nextResp = okResp({ ok: true });
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "k", relay: "apiduck", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 502); assert.match(res.body.error.message, /^ApiDuck HTTP 200: odpowiedź bez treści/);
// odpowiedź nie-JSON (np. HTML z bramki) → błąd z kodem HTTP
nextResp = () => ({ ok: false, status: 502, headers: { get: () => null }, json: async () => { throw new Error("not json"); } });
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "k", relay: "apiduck", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 502); assert.match(res.body.error.message, /^ApiDuck HTTP 502 : nieznany błąd/);

// 9. v6.24: GPT przez ApiDuck — format OpenAI na apiduck.servepics.com/v1/chat/completions
calls.length = 0;
nextResp = okResp({ choices: [{ message: { content: "{\"decyzja\":\"tak\"}" }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 5 } });
res = mkRes();
await handler({ method: "POST", body: { provider: "apiduck-gpt", model: "gpt-6.1-terra", apiKey: "duck_g", messages: [{ role: "user", parts: [{ text: "x" }] }],
  generationConfig: { responseMimeType: "application/json", reasoningEffort: "low" } } }, res);
assert.equal(res.code, 200);
assert.equal(calls[0].url, "https://apiduck.servepics.com/v1/chat/completions");
assert.equal(calls[0].opts.headers["Authorization"], "Bearer duck_g");
assert.equal(JSON.parse(calls[0].opts.body).reasoning_effort, "low");
assert.equal(res.body.candidates[0].content.parts[0].text, "{\"decyzja\":\"tak\"}");
nextResp = okResp({ error: { message: "insufficient balance", type: "billing_error" } }, 402);
res = mkRes();
await handler({ method: "POST", body: { provider: "apiduck-gpt", model: "gpt-6.1-terra", apiKey: "k", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 402); assert.match(res.body.error.message, /^ApiDuck HTTP 402 billing_error: insufficient balance/);
nextResp = okResp({ object: "chat.completion" });
res = mkRes();
await handler({ method: "POST", body: { provider: "apiduck-gpt", model: "gpt-6.1-terra", apiKey: "k", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 502); assert.match(res.body.error.message, /odpowiedź bez treści/);
calls.length = 0; res = mkRes();
await handler({ method: "POST", body: { provider: "apiduck-gpt", model: "claude-haiku-5-5", apiKey: "k", messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.code, 400); assert.equal(calls.length, 0, "apiduck-gpt tylko dla modeli GPT");
console.log("API TESTS OK");
