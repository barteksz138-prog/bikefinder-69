import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
// v6.23 (polecenie właściciela 21.11.2026): wyszukiwania e-MTB z katalogu bazy, których nie łapało żadne wyszukiwanie —
// Trek Rail / Powerfly, Specialized Levo / Kenevo, Focus Jam2, Haibike AllMtn / FullSeven / Nduro, Merida eOne, Cannondale Moterra.
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const GOOD = "Sehr gepflegtes E-Mountainbike, Akku ok, Motor ohne Fehler, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden. Abholung in Berlin.";
const ai = (o = {}) => (b) => b.action ? {} : geminiResp(analysisJson(o), { imagesAttached: b.imageUrls?.length || 0 });
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }

const HTML = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const ALL_BIKE_IDS = [...HTML.matchAll(/\{ id: "([a-z0-9_]+)",\s+label:/g)].map(m => m[1]);
const NEW = {
  trek_rail: "Trek Rail", trek_powerfly: "Trek Powerfly", specialized_levo: "Specialized Levo", specialized_kenevo: "Specialized Kenevo",
  focus_jam2: "Focus Jam2", haibike_allmtn: "Haibike AllMtn", haibike_fullseven: "Haibike FullSeven", haibike_nduro: "Haibike Nduro",
  merida_eone: "Merida eOne", cannondale_moterra: "Cannondale Moterra",
};
const NEW_IDS = Object.keys(NEW);
const OLD_IDS = ALL_BIKE_IDS.filter(id => !NEW_IDS.includes(id)); // lista znanych wyszukiwań zapisana przez v6.22
const queryOf = (url) => Object.values(NEW).find(q => url.includes(`/${q}/k0c217`)) || null;

await test("Lista wyszukiwań: 10 nowych e-MTB, numery i etykiety bez powtórzeń", async () => {
  for (const id of NEW_IDS) assert.ok(ALL_BIKE_IDS.includes(id), `brak wyszukiwania ${id}`);
  assert.equal(new Set(ALL_BIKE_IDS).size, ALL_BIKE_IDS.length, "powtórzony numer wyszukiwania");
  const labels = [...HTML.matchAll(/\{ id: "[a-z0-9_]+",\s+label: "([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(labels).size, labels.length, "powtórzona etykieta wyszukiwania");
});

await test("Nowe wyszukiwania e-MTB: link modelu z „tylko oferty”, zakresem cen i typem e-bike + MTB", async () => {
  const urls = [];
  const app = await openApp({ cfg: { selectedBikes: NEW_IDS, knownBikes: ALL_BIKE_IDS }, world: { search: (k, n, st, url) => { urls.push(url); return []; }, ai: ai() } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/, 30000);
    for (const q of Object.values(NEW)) {
      const u = urls.find(x => x.includes(`/${q}/k0c217`));
      assert.ok(u, `brak wyszukiwania „${q}”: ${urls.join(" | ")}`);
      assert.ok(u.includes("/s-fahrraeder/anzeige:angebote/preis:") && u.includes(":1400/"), `zakres cen i „tylko oferty”: ${u}`);
      assert.ok(u.endsWith("+fahrraeder.type_s:(ebike,mountainbike)"), `typ e-bike + MTB: ${u}`);
    }
  } finally { await close(app); }
});

await test("Stara konfiguracja (zapisana w v6.22): nowe wyszukiwania e-MTB włączają się same; odznaczone później zostają odznaczone", async () => {
  const urls1 = [];
  const app1 = await openApp({ cfg: { selectedBikes: ["canyon_torque"], knownBikes: OLD_IDS }, world: { search: (k, n, st, url) => { urls1.push(url); return []; }, ai: ai() } });
  try {
    await app1.start(); await app1.waitLog(/Cykl #1 zakończony/, 30000);
    const found = new Set(urls1.map(queryOf).filter(Boolean));
    assert.equal(found.size, NEW_IDS.length, `włączone same: ${[...found].join(", ")}`);
  } finally { await close(app1); }
  // Właściciel widział już nowe pozycje (są w knownBikes) i je odznaczył → nie wracają
  const urls2 = [];
  const app2 = await openApp({ cfg: { selectedBikes: ["canyon_torque"], knownBikes: ALL_BIKE_IDS }, world: { search: (k, n, st, url) => { urls2.push(url); return []; }, ai: ai() } });
  try {
    await app2.start(); await app2.waitLog(/Cykl #1 zakończony/, 30000);
    assert.equal(urls2.map(queryOf).filter(Boolean).length, 0, `odznaczone wróciły: ${urls2.join(" | ")}`);
  } finally { await close(app2); }
});

await test("Katalog e-MTB z etykiety wyszukiwania: tytuły bez sygnału e-bike dostają wpis e-MTB marki i zasady e-MTB", async () => {
  let phase = 1;
  const BASE = { haibike_allmtn: { id: "2000006230", title: "Haibike AllMtn 8.0 2018", price: 1000 }, merida_eone: { id: "2000006232", title: "Merida eONE-SIXTY 800 Gr. M", price: 1250 },
    specialized_levo: { id: "2000006234", title: "Specialized Turbo Levo Comp alt", price: 1350 } };
  const H = { id: "2000006231", title: "Haibike allmtn 2", price: 1150 };
  const M = { id: "2000006233", title: "Merida eONE-SIXTY 800 Gr. L", price: 1299 };
  const S = { id: "2000006235", title: "Specialized Turbo Levo FSR Comp 6Fattie", price: 1200 };
  const byQuery = { "Haibike AllMtn": ["haibike_allmtn", H], "Merida eOne": ["merida_eone", M], "Specialized Levo": ["specialized_levo", S] };
  // excludeElektryk: false — jak u właściciela („e-MTB analizowane”); domyślnie program odrzuca e-bike'i bez AI
  const app = await openApp({ cfg: { selectedBikes: Object.keys(BASE), knownBikes: ALL_BIKE_IDS, excludeElektryk: false },
    world: { detail: () => ({ desc: GOOD, images: 4 }), ai: ai({ typ_roweru: "elektryk_gorski", decyzja: "nie", szacowana_sprzedaz_eur: 1300, przewidywany_zysk: -20 }),
      search: (k, n, st, url) => { const hit = Object.entries(byQuery).find(([q]) => url.includes(`/${q}/k0c217`)); if (!hit) return []; const [id, fresh] = hit[1]; return phase >= 2 ? [BASE[id], fresh] : [BASE[id]]; } } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/, 30000); phase = 2;
    await app.waitUntil(() => [H, M, S].every(l => genReqs(app.st).some(b => promptOf(b).includes(l.title))), 30000, "trzy analizy AI");
    const p = (l) => promptOf(genReqs(app.st).find(b => promptOf(b).includes(l.title)));
    assert.ok(p(H).includes("BAZA CEN — e-MTB Haibike") && p(H).includes("e-MTB: ZASADY I KATEGORIE"), "Haibike: katalog e-MTB marki i zasady");
    assert.ok(p(H).includes("Model/kategoria wyszukiwania: Haibike AllMtn (e-MTB)"), "etykieta wyszukiwania w prompcie");
    assert.ok(p(M).includes("BAZA CEN — e-MTB Merida") && p(M).includes("Merida eONE-SIXTY — e-MTB"), "Merida: katalog e-MTB");
    assert.ok(p(S).includes("BAZA CEN — e-MTB Specialized") && p(S).includes("Specialized Turbo Levo — e-MTB"), "Specialized Levo: katalog e-MTB");
  } finally { await close(app); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
