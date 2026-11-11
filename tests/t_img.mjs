import handler from "./.build/gem.mjs";
import assert from "node:assert/strict";
const MiB = 1024 * 1024;
const U = (n) => `https://img.kleinanzeigen.de/api/v1/prod-ads/images/ab/1234567${n}-1234-1234-1234-123456789abc?rule=$_59.JPG`;
let sizes = {}; let lastBody;
global.fetch = async (url, opts = {}) => {
  if (url.startsWith("https://img.")) {
    const n = Number(url.match(/1234567(\d)-/)[1]); const size = sizes[n];
    return { ok: true, headers: new Map([["content-type", "image/jpeg"], ["content-length", String(size)]]), arrayBuffer: async () => new Uint8Array(size).buffer };
  }
  lastBody = JSON.parse(opts.body);
  if (url.includes("anthropic")) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: {} }) };
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }) };
};
const mkRes = () => { const r = {}; r.setHeader = () => {}; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; return r; };
// Gemini: 3×3 MiB (12 MiB base64) + 4 MiB (pominięte) + 100 B (wchodzi)
sizes = { 1: 3 * MiB, 2: 3 * MiB, 3: 3 * MiB, 4: 4 * MiB, 5: 100 };
let res = mkRes();
await handler({ method: "POST", body: { provider: "gemini", model: "gemini-2.5-flash", apiKey: "k", imageUrls: [1, 2, 3, 4, 5].map(U), messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.body.imagesAttached, 4, "Gemini: 3 duże + mały");
// Claude: 3×4,5 MiB (ponad 5 MB po zakodowaniu — pominięte) + 100 B (wchodzi)
sizes = { 1: 4.5 * MiB, 2: 4.5 * MiB, 3: 4.5 * MiB, 4: 100 };
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "k", imageUrls: [1, 2, 3, 4].map(U), messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.body.imagesAttached, 1, "Claude: mały wchodzi");
assert.equal(lastBody.messages[0].content.filter(b => b.type === "image").length, 1);
console.log("IMAGE LIMIT TESTS OK");
