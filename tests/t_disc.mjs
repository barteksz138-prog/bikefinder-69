import handler from "./.build/disc.mjs";
import assert from "node:assert/strict";
const mkRes = () => { const r = { code: 0, body: null }; r.setHeader = () => {}; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; return r; };
let next;
global.fetch = async (url, opts) => { global.lastFetch = { url, opts }; return next(); };
const W = "https://discord.com/api/webhooks/123/abc";
// F15: brak body
let res = mkRes(); await handler({ method: "POST", body: undefined }, res);
assert.equal(res.code, 400); assert.equal(res.body.ok, false);
res = mkRes(); await handler({ method: "POST", body: "tekst" }, res); assert.equal(res.code, 400);
res = mkRes(); await handler({ method: "POST", body: { webhookUrl: W } }, res); assert.equal(res.code, 400);
res = mkRes(); await handler({ method: "POST", body: { webhookUrl: "https://evil.com/api/webhooks/1/x", payload: { content: "x" } } }, res); assert.equal(res.code, 400);
res = mkRes(); await handler({ method: "POST", body: { webhookUrl: "https://discord.com:8443/api/webhooks/1/x", payload: { content: "x" } } }, res); assert.equal(res.code, 400);
res = mkRes(); await handler({ method: "POST", body: { webhookUrl: W, payload: { content: "x".repeat(25000) } } }, res); assert.equal(res.code, 413);
// sukces
next = () => ({ ok: true, status: 204, headers: { get: () => null }, json: async () => ({}) });
res = mkRes(); await handler({ method: "POST", body: { webhookUrl: W, threadId: "1234567890123", payload: { content: "x" } } }, res);
assert.deepEqual(res.body, { ok: true, status: 204, retryAfter: null, error: null });
assert.ok(global.lastFetch.url.includes("thread_id=1234567890123"));
// 403 zły webhook
next = () => ({ ok: false, status: 403, headers: { get: () => null }, json: async () => ({ message: "Unknown Webhook", code: 10015 }) });
res = mkRes(); await handler({ method: "POST", body: { webhookUrl: W, payload: { content: "x" } } }, res);
assert.deepEqual(res.body, { ok: false, status: 403, retryAfter: null, error: "Unknown Webhook" });
// 429 z retry_after
next = () => ({ ok: false, status: 429, headers: { get: (k) => k === "retry-after" ? "3" : null }, json: async () => ({ message: "You are being rate limited.", retry_after: 2.5 }) });
res = mkRes(); await handler({ method: "POST", body: { webhookUrl: W, payload: { content: "x" } } }, res);
assert.equal(res.body.status, 429); assert.equal(res.body.retryAfter, 2.5);
// błąd sieci
next = () => { throw new Error("ECONNRESET"); };
res = mkRes(); await handler({ method: "POST", body: { webhookUrl: W, payload: { content: "x" } } }, res);
assert.equal(res.code, 502); assert.equal(res.body.ok, false);
// zły thread id
res = mkRes(); await handler({ method: "POST", body: { webhookUrl: W, threadId: "abc", payload: { content: "x" } } }, res); assert.equal(res.code, 400);
console.log("DISCORD API TESTS OK");
