import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.5: materiał ramy — tekst ogłoszenia > napis na ramie > wygląd (karbon z samego wyglądu nie podnosi wyceny)
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque alt", price: 1000 };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
// first / ver — pola odpowiedzi AI w pierwszej analizie i w weryfikacji
const aiBy = (first, ver) => (b) => b.action ? {} : geminiResp(analysisJson(isVer(b) ? ver : first), { imagesAttached: b.imageUrls?.length || 0 });
const CARBON_LOOK = { material: "karbon", zrodlo: "wyglad", dowod: "zdj. 3: gładkie przejście rur przy suporcie", sprzedaz_alu_eur: 1100 };
const run = async (B, world) => {
  let phase = 1;
  const app = await openApp({ cfg: { profitTiers: [35, 35, 35, 35], transportCostEur: 70 }, world: { detail: () => ({ desc: GOOD, images: 6 }), ...world,
    search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitUntil(() => genReqs(app.st).length >= 1, 20000, "analiza AI");
  await app.waitQueueEmpty();
  return app;
};
const resultOf = async (app, id) => { // ddf_results zapisuje się z 1 s opóźnieniem
  for (let i = 0; i < 40; i++) { const a = JSON.parse(await app.ls("ddf_results") || "[]").find(r => r.listing?.listingId === id)?.analysis; if (a) return a; await app.page.waitForTimeout(200); }
  throw new Error(`brak wyniku ${id} w ddf_results`);
};

await test("„AL” w tytule: AI wyceniło karbon z wyglądu → program liczy alu już w pierwszej analizie, brak okazji i weryfikacji", async () => {
  const B = { id: "2000000651", title: "Canyon Torque AL 6.0 2020", price: 900 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 530, rama: CARBON_LOOK }, {}) });
  try {
    const p = promptOf(genReqs(app.st)[0]);
    assert.ok(p.includes("=== MATERIAŁ RAMY"), "sekcja zasad w prompcie");
    assert.ok(p.includes("Materiał ramy z tekstu (wykrył program — tytuł: „AL”): alu"), "wynik programu przy ogłoszeniu");
    assert.equal(genReqs(app.st).filter(isVer).length, 0, "bez weryfikacji");
    assert.equal(deals(app.st).length, 0, "1100 − 900 − 70 = 130 € (14%) < 35%");
    assert.ok(await app.countLogs(/🧱 .*tekst ogłoszenia mówi „alu”.*1500€ → 1100€/) >= 1, "log z przeliczeniem");
    const a = await resultOf(app, B.id);
    assert.equal(a.szacowana_sprzedaz_eur, 1100);
    assert.deepEqual([a.rama.material, a.rama.zrodlo, a.rama.sprzedaz_karbon_eur], ["alu", "tekst", 1500]);
  } finally { await close(app); }
});

await test("bez materiału w tekście: karbon z wyglądu u weryfikatora liczy się jako karbon — okazja z ostrzeżeniem i zyskiem jako alu", async () => {
  const B = { id: "2000000652", title: "Canyon Torque 2021 Enduro", price: 900 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 530, rama: CARBON_LOOK },
    { cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 530, rama: { ...CARBON_LOOK, sprzedaz_alu_eur: null } }) });
  try {
    const reqs = genReqs(app.st);
    assert.ok(promptOf(reqs[0]).includes("Materiał ramy z tekstu: nie podano"), "brak materiału w tekście");
    assert.equal(reqs.filter(isVer).length, 1, "weryfikacja");
    assert.ok(promptOf(reqs.find(isVer)).includes("7a. MATERIAŁ RAMY"), "punkt o ramie w weryfikacji");
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja");
    const e = deals(app.st)[0].payload.embeds[0];
    assert.match(e.fields.find(x => /zysk/i.test(x.name)).value, /~530€/, "zysk z wyceny karbonu");
    assert.match(e.fields.find(x => /Do sprawdzenia/.test(x.name)).value, /karbon tylko z wyglądu — sprawdź spoiny przy suporcie; jako alu zysk ~230€ \(25\.6%\)/, "bez wyceny alu: 80% z 1500 = 1200 €");
    assert.match(e.fields.find(x => /Rama/.test(x.name)).value, /^karbon \(tylko z wyglądu\) — sprawdź spoiny przy suporcie: zdj\. 3/);
    assert.equal(await app.countLogs(/🧱/), 0, "wycena bez zmian");
  } finally { await close(app); }
});

await test("czytelny napis na ramie u weryfikatora → karbon, okazja wysłana z polem „🧱 Rama”", async () => {
  const B = { id: "2000000653", title: "Canyon Torque 2021 Napis", price: 900 };
  const NAPIS = { material: "karbon", zrodlo: "napis", dowod: "zdj. 2: napis CF 8 na rurze górnej", sprzedaz_alu_eur: 1100 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 530, rama: CARBON_LOOK },
    { cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 530, rama: NAPIS }) });
  try {
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja");
    const f = deals(app.st)[0].payload.embeds[0].fields.find(x => /Rama/.test(x.name));
    assert.ok(f, "pole Rama"); assert.match(f.value, /^karbon \(napis na ramie\): zdj\. 2: napis CF 8/);
  } finally { await close(app); }
});

await test("„Carbon” w tytule (tekst) → karbon bez obniżania, nawet gdy AI ocenia tylko z wyglądu", async () => {
  const B = { id: "2000000655", title: "Canyon Torque CF 8 Carbon", price: 900 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 530, rama: CARBON_LOOK },
    { cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 530, rama: CARBON_LOOK }) });
  try {
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja");
    assert.equal(await app.countLogs(/🧱/), 0, "bez przeliczania");
    assert.match(deals(app.st)[0].payload.embeds[0].fields.find(x => /Rama/.test(x.name)).value, /^karbon \(z tekstu ogłoszenia\)/);
  } finally { await close(app); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
