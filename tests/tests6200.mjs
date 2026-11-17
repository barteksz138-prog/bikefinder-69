import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.20: klucz Freemodel (claude-n-codex.com) — modele Claude oprócz Haiku idą przez Freemodel,
// Haiku zawsze przez klucz Anthropic; błąd Freemodel → to samo zapytanie przez klucz Anthropic.
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const B = { id: "2000006201", title: "Canyon Torque AL 6 2021 L", price: 900 };
const GOOD = "Sehr gepflegtes Canyon Torque AL 6, Fox 38 Performance, Float X2, SRAM GX Eagle, Code R Bremsen, Größe L, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const CFG = { geminiModel: "claude-haiku-5-5", strongModel: "claude-sonnet-5-5", claudeKey: "sk-ant-test", freemodelKey: "sk-myapi_test" };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const twoPhase = async (opts, after) => {
  let phase = 1;
  const app = await openApp({ ...opts, world: { ...opts.world, search: () => [A, ...(phase >= 2 ? [B] : [])] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
};

await test("Haiku przez Anthropic, weryfikacja Sonnetem przez Freemodel", async () => {
  await twoPhase({ cfg: CFG, world: { detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const g = genReqs(app.st);
    const first = g.find(b => !isVer(b));
    assert.equal(first.model, "claude-haiku-5-5"); assert.equal(first.apiKey, "sk-ant-test"); assert.ok(!first.relay, "Haiku bez pośrednika");
    const v = g.filter(isVer);
    assert.equal(v.length, 1, "jedno zapytanie weryfikacji");
    assert.equal(v[0].model, "claude-sonnet-5-5"); assert.equal(v[0].provider, "anthropic");
    assert.equal(v[0].relay, "freemodel"); assert.equal(v[0].apiKey, "sk-myapi_test");
    await app.waitLog(/💲 claude-sonnet-5-5 przez Freemodel \[weryfikacja\]/);
  });
});

await test("Błąd Freemodel → weryfikacja przez klucz Anthropic, okazja nadal wysłana", async () => {
  await twoPhase({ cfg: CFG, world: { detail: () => ({ desc: GOOD }),
    ai: (b) => b.action ? {} : b.relay === "freemodel"
      ? { __status: 402, __json: { error: { message: "Freemodel HTTP 402 : insufficient balance", code: 402 } } }
      : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const v = genReqs(app.st).filter(isVer);
    assert.equal(v.length, 2, `Freemodel + zapas: ${v.map(b => b.relay || "anthropic").join(", ")}`);
    assert.equal(v[0].relay, "freemodel");
    assert.ok(!v[1].relay); assert.equal(v[1].apiKey, "sk-ant-test"); assert.equal(v[1].model, "claude-sonnet-5-5");
    await app.waitLog(/Freemodel nie odpowiedział \(Freemodel HTTP 402.*ponawiam claude-sonnet-5-5 przez klucz Anthropic/);
  });
});

await test("Bez klucza Freemodel — wszystko przez Anthropic jak dotąd", async () => {
  await twoPhase({ cfg: { ...CFG, freemodelKey: "" }, world: { detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const g = genReqs(app.st);
    assert.ok(g.every(b => !b.relay && b.apiKey === "sk-ant-test"), "bez pośrednika");
  });
});

await test("Sam klucz Freemodel wystarcza do startu, gdy model weryfikacji to Sonnet (Haiku nadal wymaga klucza Anthropic)", async () => {
  const app = await openApp({ cfg: { ...CFG, geminiModel: "gemini-2.5-flash", claudeKey: "" }, world: { search: () => [], ai: () => ({}) } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/);
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
  const app2 = await openApp({ cfg: { ...CFG, claudeKey: "" }, world: { search: () => [], ai: () => ({}) } });
  try {
    await app2.start();
    // brak klucza Anthropic dla Haiku → start zablokowany, aplikacja przechodzi do Ustawień
    await app2.page.locator('input[placeholder="sk-myapi_..."]').waitFor({ timeout: 8000 });
    assert.ok((await app2.text()).includes("Brak klucza API (Claude) dla modelu claude-haiku-5-5") || !(await app2.text()).includes("Cykl #1"), "start zablokowany");
  } finally { await app2.close(); }
});

await test("Ustawienia: pole klucza Freemodel zapisuje się w ddf_cfg", async () => {
  const app = await openApp({ cfg: { ...CFG, freemodelKey: "" }, world: { search: () => [], ai: () => ({}) } });
  try {
    await app.page.getByRole("button", { name: "⚙️ Ustawienia" }).click();
    const inp = app.page.locator('input[placeholder="sk-myapi_..."]');
    await inp.fill("sk-myapi_nowy");
    await inp.press("Enter");
    await app.waitUntil(async () => (await app.page.evaluate(() => JSON.parse(localStorage.getItem("ddf_cfg") || "{}").freemodelKey)) === "sk-myapi_nowy", 8000, "zapis klucza");
  } finally { await app.close(); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
