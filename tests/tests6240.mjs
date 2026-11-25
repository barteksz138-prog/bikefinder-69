import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.24: pośrednik ApiDuck (apiduck.servepics.com) — kolejka Freemodel → ApiDuck → klucz Anthropic (decyzja właściciela 25.11.2026).
// Haiku pomija Freemodel (odrzuca go), więc idzie ApiDuck → Anthropic. GPT: Freemodel → ApiDuck → zapas Haiku przez Anthropic.
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const routeOf = (b) => b.relay || (b.provider === "apiduck-gpt" ? "apiduck" : b.provider === "freemodel-gpt" ? "freemodel" : "anthropic");
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const B = { id: "2000006241", title: "Canyon Torque AL 6 2021 L", price: 900 };
const GOOD = "Sehr gepflegtes Canyon Torque AL 6, Fox 38 Performance, Float X2, SRAM GX Eagle, Code R Bremsen, Größe L, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const CFG = { geminiModel: "claude-haiku-5-5", strongModel: "claude-sonnet-5-5", claudeKey: "sk-ant-test", freemodelKey: "sk-myapi_test", apiduckKey: " duck_test " };
const ERR = (who, code = 402) => ({ __status: code, __json: { error: { message: `${who} HTTP ${code} billing_error: insufficient balance`, code } } });
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const twoPhase = async (opts, after) => {
  let phase = 1;
  const app = await openApp({ ...opts, world: { ...opts.world, search: () => [A, ...(phase >= 2 ? [B] : [])] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
};

await test("Wszystkie klucze: Haiku przez ApiDuck, weryfikacja Sonnetem przez Freemodel", async () => {
  await twoPhase({ cfg: CFG, world: { detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const g = genReqs(app.st);
    const first = g.find(b => !isVer(b));
    assert.equal(first.model, "claude-haiku-5-5"); assert.equal(first.provider, "anthropic");
    assert.equal(first.relay, "apiduck"); assert.equal(first.apiKey, "duck_test", "klucz ApiDuck przycięty ze spacji");
    assert.ok(g.filter(b => !isVer(b)).every(b => b.relay !== "freemodel"), "Haiku nigdy przez Freemodel");
    const v = g.filter(isVer);
    assert.equal(v.length, 1); assert.equal(v[0].relay, "freemodel"); assert.equal(v[0].apiKey, "sk-myapi_test");
    await app.waitLog(/💲 claude-haiku-5-5 przez ApiDuck \[analiza\]/);
    await app.waitLog(/💲 claude-sonnet-5-5 przez Freemodel \[weryfikacja\]/);
  });
});

await test("Błąd Freemodel → weryfikacja przez ApiDuck (nie od razu Anthropic)", async () => {
  await twoPhase({ cfg: CFG, world: { detail: () => ({ desc: GOOD }),
    ai: (b) => b.action ? {} : b.relay === "freemodel" ? ERR("Freemodel") : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const v = genReqs(app.st).filter(isVer);
    assert.deepEqual(v.map(routeOf), ["freemodel", "apiduck"], "kolejka weryfikacji");
    assert.equal(v[1].apiKey, "duck_test"); assert.equal(v[1].model, "claude-sonnet-5-5");
    await app.waitLog(/Freemodel nie odpowiedział \(Freemodel HTTP 402.*ponawiam claude-sonnet-5-5 przez ApiDuck/);
    await app.waitLog(/💲 claude-sonnet-5-5 przez ApiDuck \[weryfikacja\]/);
  });
});

await test("Freemodel i ApiDuck nie działają → klucz Anthropic na końcu, okazja nadal wysłana", async () => {
  await twoPhase({ cfg: CFG, world: { detail: () => ({ desc: GOOD }),
    ai: (b) => b.action ? {} : b.relay === "freemodel" ? ERR("Freemodel") : b.relay === "apiduck" ? ERR("ApiDuck", 503) : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const g = genReqs(app.st);
    const v = g.filter(isVer);
    assert.deepEqual(v.map(routeOf), ["freemodel", "apiduck", "anthropic"], "kolejka weryfikacji");
    assert.equal(v[2].apiKey, "sk-ant-test");
    const a = g.filter(b => !isVer(b) && promptOf(b).includes("Canyon Torque AL 6 2021"));
    assert.deepEqual(a.slice(0, 2).map(routeOf), ["apiduck", "anthropic"], "Haiku: ApiDuck → Anthropic");
    await app.waitLog(/ApiDuck nie odpowiedział \(ApiDuck HTTP 503.*ponawiam claude-haiku-5-5 przez klucz Anthropic/);
    await app.waitLog(/ApiDuck nie odpowiedział \(ApiDuck HTTP 503.*ponawiam claude-sonnet-5-5 przez klucz Anthropic/);
  });
});

await test("Sam klucz ApiDuck wystarcza (bez Anthropic i Freemodel) — wszystko przez ApiDuck", async () => {
  await twoPhase({ cfg: { ...CFG, claudeKey: "", freemodelKey: "" }, world: { detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const g = genReqs(app.st);
    assert.ok(g.length >= 2 && g.every(b => b.relay === "apiduck" && b.apiKey === "duck_test"), `drogi: ${g.map(routeOf).join(", ")}`);
  });
});

await test("ApiDuck bez zapasu: błąd idzie do analizy z nazwą pośrednika", async () => {
  await twoPhase({ cfg: { ...CFG, claudeKey: "", freemodelKey: "" }, world: { detail: () => ({ desc: GOOD }),
    ai: (b) => b.action ? {} : ERR("ApiDuck") } }, async (app) => {
    await app.waitLog(/ApiDuck: ApiDuck HTTP 402.*brak klucza Anthropic na zapas/, 20000);
  });
});

await test("GPT: błąd Freemodel → ta sama analiza GPT przez ApiDuck", async () => {
  await twoPhase({ cfg: { ...CFG, geminiModel: "gpt-6.1-terra" }, world: { detail: () => ({ desc: GOOD }),
    ai: (b) => b.action ? {} : (b.provider === "freemodel-gpt" || b.relay === "freemodel") ? ERR("Freemodel") : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const g = genReqs(app.st).filter(b => !isVer(b) && promptOf(b).includes("Canyon Torque AL 6 2021"));
    assert.deepEqual(g.slice(0, 2).map(b => `${b.provider}:${b.model}`), ["freemodel-gpt:gpt-6.1-terra", "apiduck-gpt:gpt-6.1-terra"]);
    assert.equal(g[1].apiKey, "duck_test"); assert.equal(g[1].generationConfig.reasoningEffort, "medium");
    assert.ok(Array.isArray(g[1].imageUrls) && g[1].imageUrls.length > 0, "zdjęcia także przez ApiDuck");
    await app.waitLog(/Freemodel nie odpowiedział \(Freemodel HTTP 402.*ponawiam gpt-6\.1-terra przez ApiDuck/);
    await app.waitLog(/💲 gpt-6\.1-terra przez ApiDuck \[analiza\]/);
  });
});

await test("GPT: Freemodel i ApiDuck nie działają → zapas Haiku przez klucz Anthropic", async () => {
  await twoPhase({ cfg: { ...CFG, geminiModel: "gpt-6.1-terra" }, world: { detail: () => ({ desc: GOOD }),
    ai: (b) => b.action ? {} : (b.provider !== "anthropic" || b.relay) ? ERR(b.provider === "apiduck-gpt" || b.relay === "apiduck" ? "ApiDuck" : "Freemodel") : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "okazja");
    const g = genReqs(app.st).filter(b => !isVer(b) && promptOf(b).includes("Canyon Torque AL 6 2021"));
    assert.deepEqual(g.slice(0, 3).map(b => `${routeOf(b)}:${b.model}`), ["freemodel:gpt-6.1-terra", "apiduck:gpt-6.1-terra", "anthropic:claude-haiku-5-5"]);
    assert.equal(g[2].apiKey, "sk-ant-test"); assert.equal(g[2].generationConfig.claudeEffort, "medium");
    await app.waitLog(/ApiDuck nie odpowiedział \(ApiDuck HTTP 402.*ponawiam przez claude-haiku-5-5 \(klucz Anthropic\)/);
    await app.waitLog(/💲 claude-haiku-5-5 \[analiza\]/);
  });
});

await test("GPT z samym kluczem ApiDuck — start dozwolony; z samym kluczem Anthropic — zablokowany", async () => {
  const app = await openApp({ cfg: { ...CFG, geminiModel: "gpt-6.1-terra", freemodelKey: "", claudeKey: "" }, world: { search: () => [], ai: () => ({}) } });
  try { await app.start(); await app.waitLog(/Cykl #1 zakończony/); }
  finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
  const app2 = await openApp({ cfg: { ...CFG, geminiModel: "gpt-6.1-terra", freemodelKey: "", apiduckKey: "" }, world: { search: () => [], ai: () => ({}) } });
  try {
    await app2.start();
    await app2.page.locator('input[placeholder="klucz z panelu ApiDuck"]').waitFor({ timeout: 8000 });
    assert.ok(!(await app2.text()).includes("Cykl #1"), "start zablokowany");
    assert.equal(genReqs(app2.st).length, 0);
  } finally { await app2.close(); }
});

await test("Czat na Haiku idzie przez ApiDuck, przy błędzie — przez klucz Anthropic", async () => {
  const app = await openApp({ cfg: CFG, world: { search: () => [], ai: (b) => b.relay === "apiduck" ? ERR("ApiDuck") : geminiResp("Odpowiedź Haiku") } });
  try {
    await app.page.getByRole("button", { name: /Chat AI/ }).click();
    await app.page.locator("textarea, input[type=text]").last().fill("Test");
    await app.page.keyboard.press("Enter");
    await app.page.getByText("Odpowiedź Haiku").waitFor({ timeout: 8000 });
    const r = app.st.aiReqs.filter(b => !b.action);
    assert.deepEqual(r.map(routeOf), ["apiduck", "anthropic"]);
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
    assert.ok((await app.text()).includes("ApiDuck"), "ApiDuck widoczny w aplikacji");
  } finally { await app.close(); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
