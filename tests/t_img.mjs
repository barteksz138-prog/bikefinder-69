import handler, { __clearImageCache, __imageCacheStats } from "./.build/gem.mjs";
import assert from "node:assert/strict";
const MiB = 1024 * 1024;
const U = (n) => `https://img.kleinanzeigen.de/api/v1/prod-ads/images/ab/1234567${n}-1234-1234-1234-123456789abc?rule=$_59.JPG`;
let sizes = {}; let lastBody; let imgFetches = 0;
global.fetch = async (url, opts = {}) => {
  if (url.startsWith("https://img.")) {
    imgFetches++;
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
// (v6.3: inne adresy niż wyżej — te same byłyby wzięte z cache zdjęć)
sizes = { 6: 4.5 * MiB, 7: 4.5 * MiB, 8: 4.5 * MiB, 9: 100 };
res = mkRes();
await handler({ method: "POST", body: { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "k", imageUrls: [6, 7, 8, 9].map(U), messages: [{ role: "user", parts: [{ text: "x" }] }] } }, res);
assert.equal(res.body.imagesAttached, 1, "Claude: mały wchodzi");
assert.equal(lastBody.messages[0].content.filter(b => b.type === "image").length, 1);
// v6.3: cache zdjęć — analiza z 4 zdjęciami, potem weryfikacja z 8 → 8 pobrań zamiast 12; równoczesne pobrania łączone
__clearImageCache(); imgFetches = 0;
sizes = { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100 };
const call = (ns) => handler({ method: "POST", body: { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "k", imageUrls: ns.map(U), messages: [{ role: "user", parts: [{ text: "x" }] }] } }, mkRes());
await call([1, 2, 3, 4]);
await call([1, 2, 3, 4, 5, 6, 7, 8]);
assert.equal(imgFetches, 8, "8 różnych adresów = 8 pobrań");
assert.equal(__imageCacheStats.hits, 4);
__clearImageCache(); imgFetches = 0;
await Promise.all([call([1, 2]), call([1, 2])]);
assert.equal(imgFetches, 2, "równoczesne zapytania o te same zdjęcia — jedno pobranie każdego");
console.log("IMAGE LIMIT TESTS OK");
