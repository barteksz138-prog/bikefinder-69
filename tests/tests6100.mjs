import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.10: zdjęcia 1200×1600 ($_57) · Cube z rocznikiem tylko oszacowanym < 2020 → „nie”, ale nie na stałe · części z przeróbki nie datują roweru
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque alt", price: 1000 };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
const aiBy = (first, ver = first) => (b) => b.action ? {} : geminiResp(analysisJson(isVer(b) ? ver : first), { imagesAttached: b.imageUrls?.length || 0 });
const run = async (B, world, waitAi = true) => {
  let phase = 1;
  const app = await openApp({ cfg: { profitTiers: [27, 27, 27, 27], transportCostEur: 70 }, world: { detail: () => ({ desc: GOOD, images: 6 }), ...world,
    search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  if (waitAi) await app.waitUntil(() => genReqs(app.st).length >= 1, 20000, "analiza AI");
  else await app.waitLog(/Cykl #2 zakończony/, 30000);
  await app.waitQueueEmpty();
  return app;
};
const resultOf = async (app, id) => {
  for (let i = 0; i < 40; i++) { const a = JSON.parse(await app.ls("ddf_results") || "[]").find(r => r.listing?.listingId === id)?.analysis; if (a) return a; await app.page.waitForTimeout(200); }
  throw new Error(`brak wyniku ${id} w ddf_results`);
};
const FAKTY = (rocznik, zakres) => ({ rocznik, rocznik_zrodlo: "oszacowany", rocznik_zakres: zakres, e_bike: false, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true });

const FK = (rocznik, zakres, zrodlo = "oszacowany") => ({ ...FAKTY(rocznik, zakres), rocznik_zrodlo: zrodlo });
const seenOf = async (app, id) => {
  const raw = JSON.parse(await app.ls("ddf_seen") || "{}");
  const e = Array.isArray(raw) ? raw.find(x => (x.id ?? x[0]) === id) : raw[id];
  return Array.isArray(e) ? e[1] : e;
};

await test("zdjęcia do AI w rozmiarze $_57 (1200×1600); prompt: części z przeróbki nie datują roweru", async () => {
  const B = { id: "2000006101", title: "Canyon Torque AL 5", price: 900 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 950, przewidywany_zysk: -20, decyzja: "nie", fakty: FK(2021, "2020–2022") }) });
  try {
    const r = genReqs(app.st)[0];
    assert.ok(r.imageUrls?.length >= 1, "zdjęcia dołączone");
    for (const u of r.imageUrls) assert.match(u, /\?rule=\$_57\.JPG$/, u);
    assert.ok(promptOf(r).includes("CZĘŚCI WYMIENIONE NIE DATUJĄ ROWERU"));
  } finally { await close(app); }
});

await test("Cube, oszacowany 2017, zysk OK → „nie” bez alertu, ale stary_oszac (nie na stałe)", async () => {
  const B = { id: "2000006102", title: "Cube Stereo 122 Slopeduro build custom", price: 450 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 450, szacowana_sprzedaz_eur: 782, przewidywany_zysk: 262, decyzja: "tak", fakty: FK(2017, "2016–2019") }) });
  try {
    assert.equal(deals(app.st).length, 0, "bez okazji");
    const a = await resultOf(app, B.id);
    assert.equal(a.odrzucenie, "stary_oszac");
    assert.equal(a.decyzja, "nie");
    assert.match(a.krotki_opis, /^Oszacowany rocznik 2017 \(< 2020 dla Cube\) — nie\. Rocznik niepewny/);
    const e = await seenOf(app, B.id);
    assert.equal(e?.rej, "stary_oszac", "powód zapisany, ale spoza odrzuceń na stałe");
  } finally { await close(app); }
});

await test("Cube, oszacowany 2017, zysk za mały → najpierw „zysk za mały”, rocznik jako dopisek", async () => {
  const B = { id: "2000006103", title: "Cube Stereo 120 Pro", price: 800 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 800, szacowana_sprzedaz_eur: 740, przewidywany_zysk: -130, decyzja: "nie", fakty: FK(2017, "2016–2019") }) });
  try {
    const a = await resultOf(app, B.id);
    assert.equal(a.odrzucenie, "stary_oszac");
    assert.match(a.krotki_opis, /^Zakup 800€ → szacowana sprzedaż PL 740€ — zysk za mały .* · oszacowany rocznik 2017 \(< 2020 dla Cube; niepewny/);
    assert.ok(await app.countLogs(/NIE opłaca się \(zysk za mały; rocznik oszacowany 2017 < 2020\)/) >= 1);
  } finally { await close(app); }
});

await test("Cube z rocznikiem PODANYM 2018 → „stary” na stałe (jak dotąd)", async () => {
  const B = { id: "2000006104", title: "Cube Stereo 140 HPC Race", price: 450 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 450, szacowana_sprzedaz_eur: 782, przewidywany_zysk: 262, decyzja: "tak", fakty: FK(2018, null, "podany") }) });
  try {
    const a = await resultOf(app, B.id);
    assert.equal(a.odrzucenie, "stary");
    assert.match(a.krotki_opis, /Podany rocznik 2018 \(< 2020 dla Cube\) — odrzucone/);
  } finally { await close(app); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
