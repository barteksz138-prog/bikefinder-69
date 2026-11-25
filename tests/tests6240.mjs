import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.24: pośrednik ApiDuck (apiduck.servepics.com) — kolejka Freemodel → ApiDuck → klucz Anthropic (decyzje właściciela 25.11.2026).
// W ApiDuck model analizy (GPT-6.1 Terra albo Haiku 5.5) zastępuje DeepSeek V4.1 Flash; weryfikacja Sonnetem idzie przez ApiDuck jako Sonnet.
//  - GPT-6.1 Terra: Freemodel (GPT) → ApiDuck (DeepSeek) → Anthropic (Haiku)
//  - Haiku 5.5:     ApiDuck (DeepSeek) → Anthropic (Haiku)          — Freemodel odrzuca Haiku
//  - Sonnet 5.5:    Freemodel → ApiDuck → Anthropic (zawsze Sonnet)
const DS = "deepseek-v4.1-flash";
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const routeOf = (b) => b.relay || (b.provider === "apiduck-openai" ? "apiduck" : b.provider === "freemodel-gpt" ? "freemodel" : "anthropic");
const hop = (b) => `${routeOf(b)}:${b.model}`;
const isDuck = (b) => b.relay === "apiduck" || b.provider === "apiduck-openai";
const isFm = (b) => b.relay === "freemodel" || b.provider === "freemodel-gpt";
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const B = { id: "2000006241", title: "Canyon Torque AL 6 2021 L", price: 900 };
const ofB = (b) => promptOf(b).includes("Canyon Torque AL 6 2021");
const GOOD = "Sehr gepflegtes Canyon Torque AL 6, Fox 38 Performance, Float X2, SRAM GX Eagle, Code R Bremsen, Größe L, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const CFG = { geminiModel: "claude-haiku-5-5", strongModel: "claude-sonnet-5-5", claudeKey: "sk-ant-test", freemodelKey: "sk-myapi_test", apiduckKey: " duck_test " };
const GPT = { ...CFG, geminiModel: "gpt-6.1-terra" };
const ERR = (who, code = 402) => ({ __status: code, __json: { error: { message: `${who} HTTP ${code} billing_error: insufficient balance`, code } } });
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const twoPhase = async (opts, after) => {
  let phase = 1;
  const app = await openApp({ ...opts, world: { ...opts.world, search: () => [A, ...(phase >= 2 ? [B] : [])] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
};
const ok = (b) => b.action ? {} : geminiResp(analysisJson());

await test("GPT: wszystko działa — analiza GPT przez Freemodel, weryfikacja Sonnetem przez Freemodel", async () => {
  await twoPhase({ cfg: GPT, world: { detail: () => ({ desc: GOOD }), ai: ok } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const g = genReqs(app.st);
    assert.ok(g.filter(b => !isVer(b)).every(b => hop(b) === "freemodel:gpt-6.1-terra"), `analiza: ${g.filter(b => !isVer(b)).map(hop).join(", ")}`);
    assert.deepEqual(g.filter(isVer).map(hop), ["freemodel:claude-sonnet-5-5"]);
    assert.ok(!g.some(isDuck), "bez ApiDuck, gdy Freemodel działa");
    await app.waitLog(/💲 gpt-6\.1-terra przez Freemodel \[analiza\]/);
  });
});

await test("GPT: błąd Freemodel → analiza DeepSeekiem przez ApiDuck, weryfikacja Sonnetem przez ApiDuck", async () => {
  await twoPhase({ cfg: GPT, world: { detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : isFm(b) ? ERR("Freemodel") : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const a = genReqs(app.st).filter(b => !isVer(b) && ofB(b));
    assert.deepEqual(a.slice(0, 2).map(hop), ["freemodel:gpt-6.1-terra", `apiduck:${DS}`]);
    assert.equal(a[1].provider, "apiduck-openai"); assert.equal(a[1].apiKey, "duck_test", "klucz ApiDuck przycięty ze spacji");
    assert.equal(a[1].generationConfig.reasoningEffort, "medium");
    assert.ok(Array.isArray(a[1].imageUrls) && a[1].imageUrls.length > 0, "zdjęcia także do DeepSeeka");
    const v = genReqs(app.st).filter(isVer);
    assert.deepEqual(v.map(hop), ["freemodel:claude-sonnet-5-5", "apiduck:claude-sonnet-5-5"], "weryfikacja zostaje na Sonnecie");
    assert.equal(v[1].provider, "anthropic");
    await app.waitLog(/Freemodel nie odpowiedział \(Freemodel HTTP 402.*ponawiam przez deepseek-v4\.1-flash \(ApiDuck\)/);
    await app.waitLog(/💲 deepseek-v4\.1-flash przez ApiDuck \[analiza\]/);
    await app.waitLog(/💲 claude-sonnet-5-5 przez ApiDuck \[weryfikacja\]/);
  });
});

await test("GPT: Freemodel i ApiDuck nie działają → Haiku przez klucz Anthropic, Sonnet przez klucz Anthropic", async () => {
  await twoPhase({ cfg: GPT, world: { detail: () => ({ desc: GOOD }),
    ai: (b) => b.action ? {} : isFm(b) ? ERR("Freemodel") : isDuck(b) ? ERR("ApiDuck", 503) : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const a = genReqs(app.st).filter(b => !isVer(b) && ofB(b));
    assert.deepEqual(a.slice(0, 3).map(hop), ["freemodel:gpt-6.1-terra", `apiduck:${DS}`, "anthropic:claude-haiku-5-5"]);
    assert.equal(a[2].apiKey, "sk-ant-test"); assert.equal(a[2].generationConfig.claudeEffort, "medium");
    assert.deepEqual(genReqs(app.st).filter(isVer).map(hop), ["freemodel:claude-sonnet-5-5", "apiduck:claude-sonnet-5-5", "anthropic:claude-sonnet-5-5"]);
    await app.waitLog(/ApiDuck nie odpowiedział \(ApiDuck HTTP 503.*ponawiam przez claude-haiku-5-5 \(klucz Anthropic\)/);
    await app.waitLog(/💲 claude-haiku-5-5 \[analiza\]/);
  });
});

await test("Haiku jako model analizy: najpierw DeepSeek przez ApiDuck (bez Freemodel), przy błędzie Haiku przez Anthropic", async () => {
  await twoPhase({ cfg: CFG, world: { detail: () => ({ desc: GOOD }), ai: ok } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const a = genReqs(app.st).filter(b => !isVer(b));
    assert.ok(a.every(b => hop(b) === `apiduck:${DS}`), `analiza: ${a.map(hop).join(", ")}`);
    await app.waitLog(/💲 deepseek-v4\.1-flash przez ApiDuck \[analiza\]/);
  });
  await twoPhase({ cfg: CFG, world: { detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : isDuck(b) ? ERR("ApiDuck") : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const a = genReqs(app.st).filter(b => !isVer(b) && ofB(b));
    assert.deepEqual(a.slice(0, 2).map(hop), [`apiduck:${DS}`, "anthropic:claude-haiku-5-5"]);
    await app.waitLog(/ApiDuck nie odpowiedział \(ApiDuck HTTP 402.*ponawiam claude-haiku-5-5 przez klucz Anthropic/);
  });
});

await test("Bez klucza ApiDuck — kolejka jak w v6.23 (Haiku przez Anthropic, Sonnet przez Freemodel)", async () => {
  await twoPhase({ cfg: { ...CFG, apiduckKey: "" }, world: { detail: () => ({ desc: GOOD }), ai: ok } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const g = genReqs(app.st);
    assert.ok(g.filter(b => !isVer(b)).every(b => hop(b) === "anthropic:claude-haiku-5-5"));
    assert.deepEqual(g.filter(isVer).map(hop), ["freemodel:claude-sonnet-5-5"]);
    assert.ok(!g.some(isDuck));
  });
});

await test("Start: sam ApiDuck nie wystarcza — Haiku wymaga klucza Anthropic, GPT klucza Freemodel", async () => {
  for (const cfg of [{ ...CFG, claudeKey: "", freemodelKey: "" }, { ...GPT, freemodelKey: "" }]) {
    const app = await openApp({ cfg, world: { search: () => [], ai: () => ({}) } });
    try {
      await app.start();
      await app.page.locator('input[placeholder="klucz z panelu ApiDuck"]').waitFor({ timeout: 8000 });
      assert.ok(!(await app.text()).includes("Cykl #1"), `start zablokowany (${cfg.geminiModel})`);
      assert.equal(genReqs(app.st).length, 0);
    } finally { await app.close(); }
  }
});

await test("Sonnet do weryfikacji wystarczy przez ApiDuck (bez Freemodel i Anthropic), gdy analiza to Gemini", async () => {
  const app = await openApp({ cfg: { ...CFG, geminiModel: "gemini-2.5-flash", geminiKey: "AIza-test", claudeKey: "", freemodelKey: "" }, world: { search: () => [], ai: () => ({}) } });
  try { await app.start(); await app.waitLog(/Cykl #1 zakończony/); }
  finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

await test("GPT bez klucza Anthropic: Freemodel i ApiDuck nie działają → błąd z nazwą ApiDuck", async () => {
  await twoPhase({ cfg: { ...GPT, claudeKey: "" }, world: { detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : ERR(isFm(b) ? "Freemodel" : "ApiDuck") } }, async (app) => {
    await app.waitLog(/ApiDuck: ApiDuck HTTP 402.*brak klucza Anthropic na zapas — Haiku/, 20000);
  });
});

await test("Czat na GPT: Freemodel, przy błędzie DeepSeek przez ApiDuck", async () => {
  const app = await openApp({ cfg: GPT, world: { search: () => [], ai: (b) => isFm(b) ? ERR("Freemodel") : geminiResp("Odpowiedź DeepSeek") } });
  try {
    await app.page.getByRole("button", { name: /Chat AI/ }).click();
    await app.page.locator("textarea, input[type=text]").last().fill("Test");
    await app.page.keyboard.press("Enter");
    await app.page.getByText("Odpowiedź DeepSeek").waitFor({ timeout: 8000 });
    assert.deepEqual(app.st.aiReqs.filter(b => !b.action).map(hop), ["freemodel:gpt-6.1-terra", `apiduck:${DS}`]);
  } finally { await app.close(); }
});

await test("Ustawienia: pole klucza ApiDuck zapisuje się w ddf_cfg, Status pokazuje ApiDuck", async () => {
  const app = await openApp({ cfg: { ...CFG, apiduckKey: "" }, world: { search: () => [], ai: () => ({}) } });
  try {
    await app.page.getByRole("button", { name: "⚙️ Ustawienia" }).click();
    const inp = app.page.locator('input[placeholder="klucz z panelu ApiDuck"]');
    await inp.fill("duck_nowy");
    await inp.press("Enter");
    await app.waitUntil(async () => (await app.page.evaluate(() => JSON.parse(localStorage.getItem("ddf_cfg") || "{}").apiduckKey)) === "duck_nowy", 8000, "zapis klucza");
    await app.page.getByRole("button", { name: "🔍 Skaner" }).click();
    await app.page.getByText("klucz wpisany (analiza: DeepSeek)").waitFor({ timeout: 8000 });
  } finally { await app.close(); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
