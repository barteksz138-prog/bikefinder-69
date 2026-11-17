import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.21: model analizy GPT-6.1 Terra przez Freemodel (format OpenAI w pośredniku); zapas przy błędzie — Haiku przez klucz Anthropic.
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const B = { id: "2000006211", title: "Canyon Torque AL 6 2021 L", price: 900 };
const GOOD = "Sehr gepflegtes Canyon Torque AL 6, Fox 38 Performance, Float X2, SRAM GX Eagle, Code R Bremsen, Größe L, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const CFG = { geminiModel: "gpt-6.1-terra", strongModel: "claude-sonnet-5-5", claudeKey: "sk-ant-test", freemodelKey: " sk-myapi_test" };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const twoPhase = async (opts, after) => {
  let phase = 1;
  const app = await openApp({ ...opts, world: { ...opts.world, search: () => [A, ...(phase >= 2 ? [B] : [])] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
};

await test("Analiza GPT-6.1 Terra przez Freemodel, weryfikacja Sonnetem (też przez Freemodel)", async () => {
  await twoPhase({ cfg: CFG, world: { detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const g = genReqs(app.st);
    const first = g.find(b => !isVer(b));
    assert.equal(first.provider, "freemodel-gpt"); assert.equal(first.model, "gpt-6.1-terra");
    assert.equal(first.apiKey, "sk-myapi_test", "klucz przycięty ze spacji");
    assert.equal(first.generationConfig.reasoningEffort, "medium"); assert.equal(first.generationConfig.maxOutputTokens, 16000);
    assert.ok(Array.isArray(first.imageUrls) && first.imageUrls.length > 0, "zdjęcia do GPT");
    assert.equal(first.messages[0].parts[0].cacheControl, true, "stała część oznaczona (zdjęcia za nią)");
    const v = g.find(isVer);
    assert.equal(v.model, "claude-sonnet-5-5"); assert.equal(v.relay, "freemodel");
    await app.waitLog(/💲 gpt-6\.1-terra przez Freemodel \[analiza\]/);
  });
});

await test("Błąd Freemodel przy GPT → ta sama analiza przez Haiku (klucz Anthropic), okazja wysłana", async () => {
  await twoPhase({ cfg: CFG, world: { detail: () => ({ desc: GOOD }),
    ai: (b) => b.action ? {} : (b.provider === "freemodel-gpt" || b.relay === "freemodel")
      ? { __status: 402, __json: { error: { message: "Freemodel HTTP 402 billing_error: insufficient balance", code: 402 } } }
      : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const g = genReqs(app.st).filter(b => !isVer(b));
    const fb = g.find(b => b.model === "claude-haiku-5-5");
    assert.ok(fb, `zapas Haiku: ${g.map(b => b.model).join(", ")}`);
    assert.equal(fb.provider, "anthropic"); assert.equal(fb.apiKey, "sk-ant-test"); assert.equal(fb.generationConfig.claudeEffort, "medium");
    assert.ok(promptOf(fb).includes("Canyon Torque AL 6 2021"), "ten sam prompt");
    await app.waitLog(/Freemodel nie odpowiedział \(Freemodel HTTP 402.*ponawiam przez claude-haiku-5-5/);
    await app.waitLog(/💲 claude-haiku-5-5 \[analiza\]/);
  });
});

await test("GPT bez klucza Freemodel — start zablokowany", async () => {
  const app = await openApp({ cfg: { ...CFG, freemodelKey: "" }, world: { search: () => [], ai: () => ({}) } });
  try {
    await app.start();
    await app.page.locator('input[placeholder="sk-myapi_..."]').waitFor({ timeout: 8000 });
    assert.equal(genReqs(app.st).length, 0);
  } finally { await app.close(); }
});

await test("Czat na modelu GPT idzie przez Freemodel", async () => {
  const app = await openApp({ cfg: CFG, world: { search: () => [], ai: (b) => geminiResp("Odpowiedź GPT") } });
  try {
    await app.page.getByRole("button", { name: /Chat AI/ }).click();
    await app.page.locator("textarea, input[type=text]").last().fill("Test");
    await app.page.keyboard.press("Enter");
    await app.page.getByText("Odpowiedź GPT").waitFor({ timeout: 8000 });
    const r = app.st.aiReqs.find(b => !b.action);
    assert.equal(r.provider, "freemodel-gpt"); assert.equal(r.apiKey, "sk-myapi_test");
  } finally { await app.close(); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
