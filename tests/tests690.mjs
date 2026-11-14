import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.9: Canyon Spectral od 2018 (amortyzator pionowo = rama 2014–2017 → odrzucony) · dirt nieznanej marki z nierozpoznanym
// widelcem, który wygląda staro → odrzucony · „za mało opisu” z zyskiem daleko pod progiem → „nie”
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const nears = (st) => st.discord.filter(d => d.webhookUrl.includes("/3/near"));
const uncertains = (st) => st.discord.filter(d => /Niepewne rowery/.test(d.payload.content || ""));
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque alt", price: 1000 };
const NEAR = "https://discord.com/api/webhooks/3/near";
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
const aiBy = (first, ver = first) => (b) => b.action ? {} : geminiResp(analysisJson(isVer(b) ? ver : first), { imagesAttached: b.imageUrls?.length || 0 });
const run = async (B, world, { cfg = {}, waitAi = true } = {}) => {
  let phase = 1;
  const app = await openApp({ cfg: { profitTiers: [27, 27, 27, 27], transportCostEur: 70, ...cfg }, world: { detail: () => ({ desc: GOOD, images: 6 }), ...world,
    search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  if (waitAi) await app.waitUntil(() => genReqs(app.st).length >= 1, 20000, "analiza AI");
  else await app.waitLog(/Cykl #2 zakończony/, 30000);
  await app.waitQueueEmpty();
  await app.page.waitForTimeout(800);
  return app;
};
const resultOf = async (app, id) => {
  for (let i = 0; i < 40; i++) { const a = JSON.parse(await app.ls("ddf_results") || "[]").find(r => r.listing?.listingId === id)?.analysis; if (a) return a; await app.page.waitForTimeout(200); }
  throw new Error(`brak wyniku ${id} w ddf_results`);
};
const FAKTY = (rocznik, zrodlo = "oszacowany", zakres = null) => ({ rocznik, rocznik_zrodlo: zrodlo, rocznik_zakres: zakres, e_bike: false, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true });
const DEAL = { cena_zakupu_eur: 650, szacowana_sprzedaz_eur: 1100, przewidywany_zysk: 380, decyzja: "tak" };

// ── 1. Canyon Spectral od 2018 ──
await test("Spectral z rocznikiem 2017 w tytule → odrzucony przed AI (Spectral od 2018)", async () => {
  const B = { id: "2000000691", title: "Canyon Spectral AL 2017 Mountainbike Größe XL 27.5 Zoll", price: 650 };
  const app = await run(B, { ai: aiBy(DEAL) }, { waitAi: false });
  try {
    assert.equal(genReqs(app.st).length, 0, "bez analizy AI");
    assert.ok(await app.countLogs(/rok 2017 < 2018 \(Canyon Spectral\)/) >= 1, "log z progiem modelu");
  } finally { await close(app); }
});

await test("Spectral bez roku: AI widzi amortyzator pionowo (2017, zakres 2014–2017) → „stary”, prompt podaje regułę", async () => {
  const B = { id: "2000000692", title: "Canyon Spectral AL 6.0 Größe L", price: 650 };
  const app = await run(B, { ai: aiBy({ ...DEAL, fakty: FAKTY(2017, "oszacowany", "2014–2017") }) });
  try {
    const p = promptOf(genReqs(app.st)[0]);
    assert.ok(p.includes("Minimalny rocznik dla modelu Canyon Spectral: 2018"), "próg modelu w prompcie");
    assert.ok(p.includes("PIONOWO przed rurą podsiodłową") && p.includes("rama rozstrzyga"), "reguła amortyzatora w prompcie pierwszej analizy");
    assert.ok(p.includes("AL 2018–2021") && !p.includes("AL 2017–2021"), "pasmo w bazie od 2018");
    assert.equal(deals(app.st).length, 0, "bez okazji");
    assert.equal(genReqs(app.st).filter(isVer).length, 0, "bez weryfikacji");
    const a = await resultOf(app, B.id);
    assert.equal(a.odrzucenie, "stary");
    assert.match(a.krotki_opis, /Oszacowany rocznik 2017 \(< 2018 dla Canyon Spectral\) — odrzucone/);
  } finally { await close(app); }
});

await test("Spectral 2019 (amortyzator poziomo) → okazja; oszacowany 2017 z zakresem 2016–2019 liczony jako 2018", async () => {
  const B = { id: "2000000693", title: "Canyon Spectral AL 6.0 Trailbike", price: 650 };
  let app = await run(B, { ai: aiBy({ ...DEAL, fakty: FAKTY(2019, "podany") }) });
  try { await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja Spectral 2019"); } finally { await close(app); }
  app = await run({ ...B, id: "2000000694" }, { ai: aiBy({ ...DEAL, fakty: FAKTY(2017, "oszacowany", "2016–2019") }) });
  try {
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja przy zakresie sięgającym 2018");
    assert.ok(await app.countLogs(/zakres 2016–2019 sięga 2018 — liczę 2018/) >= 1);
  } finally { await close(app); }
});

await test("Inne modele bez zmian: Canyon Torque 2017 idzie do AI bez progu modelu; Spectral:ON nie dostaje reguły", async () => {
  const B = { id: "2000000695", title: "Canyon Torque AL 5.0 2017 Größe M", price: 650 };
  let app = await run(B, { ai: aiBy({ ...DEAL, fakty: FAKTY(2017, "podany") }) });
  try {
    assert.ok(!promptOf(genReqs(app.st)[0]).includes("Minimalny rocznik dla modelu"), "Torque bez progu modelu");
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja Torque 2017");
  } finally { await close(app); }
  app = await run({ id: "2000000696", title: "Canyon Spectral:ON CF 7 2021", price: 1300 }, { ai: aiBy({ typ_roweru: "elektryk_gorski", cena_zakupu_eur: 1300, szacowana_sprzedaz_eur: 1400, przewidywany_zysk: 30, decyzja: "nie", fakty: { ...FAKTY(2021, "podany"), e_bike: true } }) }, { cfg: { excludeElektryk: false } });
  try { assert.ok(!promptOf(genReqs(app.st)[0]).includes("Minimalny rocznik dla modelu"), "Spectral:ON bez progu Spectrala"); } finally { await close(app); }
});

// ── 2. Dirt nieznanej marki ──
// 350 € zakupu, próg 27%, sprzedaż 500 €: zysk 80 € (22,9%) — bez nowej reguły to „na granicy” (opłaca się do 338 €)
const DIRT = { typ_roweru: "dirt", cena_zakupu_eur: 350, szacowana_sprzedaz_eur: 500, przewidywany_zysk: 80, decyzja: "nie",
  fakty: FAKTY(null, "brak"), widelec: { model: "nieznany", zrodlo: "nieznany", sztywny: false } };

await test("Dirt: marka nieznana + widelec nierozpoznany + wygląda staro → odrzucony, bez weryfikacji i bez „na granicy”", async () => {
  const B = { id: "2000000697", title: "Dirtbike Fahrrad", price: 350 };
  const app = await run(B, { ai: aiBy({ ...DIRT, dirt: { marka: "nieznana", wyglada_staro: true } }) }, { cfg: { nearWebhook: NEAR } });
  try {
    const p = promptOf(genReqs(app.st)[0]);
    assert.ok(p.includes('"wyglada_staro"') && p.includes("Najtańsze dirty”; gdy do tego widelec jest nierozpoznany"), "pole dirt i reguła bazy w prompcie");
    const a = await resultOf(app, B.id);
    assert.equal(a.odrzucenie, "dirt_stary");
    assert.match(a.krotki_opis, /Dirt nieznanej marki z nierozpoznanym widelcem, wygląda na stary — odrzucone/);
    assert.equal(genReqs(app.st).filter(isVer).length, 0, "bez weryfikacji");
    assert.equal(nears(app.st).length, 0, "bez alertu „na granicy”");
    assert.equal(JSON.parse(await app.ls("ddf_seen")).find(e => e.id === B.id)?.rej, "dirt_stary", "odrzucenie na stałe w pamięci");
  } finally { await close(app); }
});

await test("Dirt: brakuje jednego z trzech warunków → zwykła ocena („na granicy” z weryfikacją)", async () => {
  const cases = [
    ["2000000698", { dirt: { marka: "nieznana", wyglada_staro: false } }],                                   // nie wygląda staro
    ["2000000699", { dirt: { marka: "znana", wyglada_staro: true } }],                                        // znana marka
    ["2000000700", { dirt: { marka: "nieznana", wyglada_staro: true }, widelec: { model: "RockShox Argyle", zrodlo: "napis", sztywny: false } }], // widelec rozpoznany
    ["2000000701", {}],                                                                                       // brak pola dirt (stara odpowiedź)
  ];
  for (const [id, extra] of cases) {
    const app = await run({ id, title: "Dirtbike Fahrrad", price: 350 }, { ai: aiBy({ ...DIRT, ...extra }) }, { cfg: { nearWebhook: NEAR } });
    try {
      await app.waitUntil(() => nears(app.st).length >= 1, 20000, `alert „na granicy” (${id})`);
      assert.equal((await resultOf(app, id)).odrzucenie, null, `bez odrzucenia (${id})`);
    } finally { await close(app); }
  }
});

// ── 3. „Za mało opisu” z kompletem liczb ──
await test("„Niepewne — za mało opisu” z zyskiem ponad 10 pp pod progiem → „nie” (nie lista niepewnych)", async () => {
  const B = { id: "2000000702", title: "Canyon Torque CF 8 Hybrid", price: 1299 };
  const app = await run(B, { ai: aiBy({ decyzja: "niepewne", niepewne_kategoria: "za_malo_opisu", cena_zakupu_eur: 1299, szacowana_sprzedaz_eur: 1469, przewidywany_zysk: 100, powod_decyzji: "pojemność baterii nieustalona" }) });
  try {
    assert.ok(await app.countLogs(/"niepewne" \(za mało opisu\), ale liczby są kompletne — zysk 7\.7% < próg 27% → "nie"/) >= 1, "log reguły");
    const a = await resultOf(app, B.id);
    assert.equal(a.decyzja, "nie"); assert.equal(a.niepewne_kategoria, null);
    await app.waitLog(/Cykl #3 zakończony/, 40000);
    assert.equal(uncertains(app.st).length, 0, "bez wpisu na liście niepewnych");
  } finally { await close(app); }
});

await test("„Za mało opisu” z zyskiem do 10 pp pod progiem albo bez wyceny → zostaje „niepewne”", async () => {
  // 1000 € zakupu, sprzedaż 1260 €: zysk 190 € (19%) — 8 pp pod progiem 27%
  let app = await run({ id: "2000000703", title: "Canyon Torque CF 7 Blisko", price: 1000 }, { ai: aiBy({ decyzja: "niepewne", niepewne_kategoria: "za_malo_opisu", cena_zakupu_eur: 1000, szacowana_sprzedaz_eur: 1260, przewidywany_zysk: 190 }) });
  try {
    assert.equal((await resultOf(app, "2000000703")).decyzja, "niepewne");
    await app.waitUntil(() => uncertains(app.st).length >= 1, 40000, "lista niepewnych");
  } finally { await close(app); }
  app = await run({ id: "2000000704", title: "Canyon Torque CF 7 Bez wyceny", price: 1000 }, { ai: aiBy({ decyzja: "niepewne", niepewne_kategoria: "za_malo_opisu", cena_zakupu_eur: 1000, szacowana_sprzedaz_eur: null, przewidywany_zysk: 0 }) });
  try { assert.equal((await resultOf(app, "2000000704")).decyzja, "niepewne"); } finally { await close(app); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
