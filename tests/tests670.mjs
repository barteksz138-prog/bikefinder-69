import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.7: zasada rocznika i pasma zależna od etapu · ściąga generacji tylko dla weryfikatora · (v6.13: „na granicy” już bez weryfikacji)
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const nears = (st) => st.discord.filter(d => d.webhookUrl.includes("/3/near"));
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque alt", price: 1000 };
const NEAR = "https://discord.com/api/webhooks/3/near";
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
const aiBy = (first, ver = first) => (b) => b.action ? {} : geminiResp(analysisJson(isVer(b) ? ver : first), { imagesAttached: b.imageUrls?.length || 0 });
const run = async (B, world, cfg = {}) => {
  let phase = 1;
  const app = await openApp({ cfg: { profitTiers: [27, 27, 27, 27], transportCostEur: 70, ...cfg }, world: { detail: () => ({ desc: GOOD, images: 6 }), ...world,
    search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitUntil(() => genReqs(app.st).length >= 1, 20000, "analiza AI");
  await app.waitQueueEmpty();
  await app.page.waitForTimeout(800);
  return app;
};
// 900 € zakupu, próg 27%: okazja od sprzedaży 1213 € (900 + 70 + 243); „na granicy” — cena musi spaść najwyżej o 20%
const NO_NEAR = { cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1100, przewidywany_zysk: 130, decyzja: "nie" };

await test("pierwsza analiza: środkowy rok i środek pasma, bez ściągi; weryfikacja: dolna granica i ściąga generacji modelu", async () => {
  const B = { id: "2000000671", title: "Trek Slash 8 29 Enduro", price: 900 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1400, przewidywany_zysk: 430, decyzja: "tak" }) });
  try {
    const reqs = genReqs(app.st), first = promptOf(reqs.find(b => !isVer(b))), ver = promptOf(reqs.find(isVer));
    assert.ok(first.includes("ZASADA ROCZNIKA I PASMA (pierwsza analiza)") && first.includes("ŚRODKOWY rok") && first.includes("ŚRODEK pasma"));
    assert.ok(!first.includes("ŚCIĄGA GENERACJI"), "Haiku bez ściągi");
    assert.ok(!first.includes("wpisz najstarszy pasujący"), "stara zasada usunięta ze stałej części");
    assert.ok(ver.includes("ZASADA ROCZNIKA I PASMA (weryfikacja)") && ver.includes("DOLNA granica pasma"));
    assert.ok(ver.includes("ŚCIĄGA GENERACJI — Trek Slash") && ver.includes("Gen 6") && ver.includes("Straight Shot"), "ściąga w weryfikacji");
    assert.ok(!ver.includes("ZASADA ROCZNIKA I PASMA (pierwsza analiza)"));
  } finally { await close(app); }
});

await test("„na granicy” bez webhooka → bez weryfikacji (jak dotąd)", async () => {
  const B = { id: "2000000672", title: "Canyon Torque CF 2", price: 900 };
  const app = await run(B, { ai: aiBy(NO_NEAR) });
  try {
    assert.equal(genReqs(app.st).filter(isVer).length, 0);
    assert.ok(await app.countLogs(/Na granicy okazji/) >= 1);
  } finally { await close(app); }
});

// v6.13 (decyzja właściciela 15.11.2026): „na granicy” ocenia tylko model analizy — bez weryfikacji modelem weryfikacji
await test("„na granicy” z webhookiem → bez weryfikacji, alert z wyceną pierwszej analizy", async () => {
  const B = { id: "2000000673", title: "Canyon Torque CF 3", price: 900 };
  const app = await run(B, { ai: aiBy(NO_NEAR, { cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 900, przewidywany_zysk: -70, decyzja: "nie" }) }, { nearWebhook: NEAR });
  try {
    await app.waitUntil(() => nears(app.st).length >= 1, 15000, "alert na granicy");
    assert.equal(genReqs(app.st).filter(isVer).length, 0, "bez weryfikacji");
    assert.equal(genReqs(app.st).length, 1, "tylko pierwsza analiza (14,4% — daleko od progu, bez dokładnej)");
    const e = nears(app.st)[0].payload.embeds[0];
    assert.match(e.fields.find(f => /Szac\. sprzedaż/.test(f.name)).value, /1100€/, "wycena pierwszej analizy");
    assert.equal(await app.countLogs(/Weryfikacja „na granicy”/), 0);
  } finally { await close(app); }
});

await test("„na granicy” bez pełnego opisu (po 2 h czekania) → bez alertu i bez weryfikacji", async () => {
  const href = "https://www.kleinanzeigen.de/s-anzeige/x/2000000676-217-1234", old = Date.now() - 3 * 3600e3;
  const app = await openApp({ cfg: { profitTiers: [27, 27, 27, 27], transportCostEur: 70, nearWebhook: NEAR },
    ls: { ddf_scan_state: { searches: {} }, ddf_pending: [{ listing: { listingId: href, title: "Canyon Torque CF 6", price: 900, href, desc: "kurz" }, stage: "analyze", groqType: "full", attempts: 0, addedAt: old, detailsMissingSince: old }] },
    world: { search: () => [A], detail: () => ({ status: 500 }), ai: aiBy(NO_NEAR) } });
  try {
    await app.start();
    await app.waitLog(/„Na granicy” bez pełnego opisu — nie wysyłam/, 20000);
    await app.page.waitForTimeout(800);
    assert.equal(nears(app.st).length, 0);
    assert.equal(genReqs(app.st).filter(isVer).length, 0);
  } finally { await close(app); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
