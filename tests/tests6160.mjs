import { openApp, closeBrowser, analysisJson, geminiResp, groqResp } from "./harness.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
// v6.16: SZOSY I GRAVELE — osobny tor włączany jednym przełącznikiem (domyślnie wyłączony): własne wyszukiwania 200–800 €,
// własny filtr słów, własne polecenie Groqa i analizy, limit rocznika 2014, pole „naped” (grupa osprzętu i hamulce) w alercie
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const blk = src.match(/\/\/ ==ROAD_START==[\s\S]*?\/\/ ==ROAD_END==/);
assert.ok(blk, "blok ROAD w index.html");
const R = new Function(`const EUR_PLN_RATE = 4.35;\n${blk[0]}\nreturn { ROAD_SEARCHES, ROAD_MAX_BUY_DEFAULT, ROAD_MIN_YEAR, KB_ROAD, roadSearchUrl, roadGroqPrompt, buildRoadStaticPrefix, normalizeDrivetrain, drivetrainNeedsCheck, fmtDrivetrain, drivetrainField, isRoad, goodTypesOf, ROAD_FILTER_KEYWORDS_DEFAULT, ROAD_BRAND_PATTERNS, selectRoadKbChunkIds };`)();
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }

await test("blok ROAD: wyszukiwania, link bez filtra typu, limity, baza i polecenia", async () => {
  assert.equal(R.ROAD_MAX_BUY_DEFAULT, 800);
  assert.equal(R.ROAD_MIN_YEAR, 2014);
  const ids = R.ROAD_SEARCHES.map(b => b.id);
  assert.equal(ids.length, new Set(ids).size, "unikalne id");
  assert.ok(ids.every(id => id.startsWith("road_")), "id z przedrostkiem road_ (nie kolidują z MTB)");
  assert.ok(R.ROAD_SEARCHES.every(b => b.profile === "road" && b.query && b.label.startsWith("🚴 ")));
  // ten sam układ linku co sprawdzone na żywo wyszukiwania „Dirt” (bez filtra typu), fraza kodowana jak w modelach MTB
  assert.equal(R.roadSearchUrl({ query: "Canyon Endurace" }, 200, 800), "https://www.kleinanzeigen.de/s-fahrraeder/anzeige:angebote/preis:200:800/Canyon%20Endurace/k0c217");
  // wyszukiwania ogólne: tylko działy „Damen” i „Herren” (bez akcesoriów) — sprawdzone na żywo 15.11.2026
  assert.equal(R.roadSearchUrl(R.ROAD_SEARCHES.find(b => b.id === "road_gravel"), 200, 800), "https://www.kleinanzeigen.de/s-fahrraeder/anzeige:angebote/preis:200:800/Gravel/k0c217+fahrraeder.art_s:(damen,herren)");
  assert.deepEqual(R.ROAD_SEARCHES.filter(b => b.arts).map(b => b.id), ["road_gravel", "road_gravelbike", "road_cyclocross", "road_carbon", "road_ultegra", "road_105"]);
  assert.deepEqual(R.goodTypesOf({ profile: "road" }), ["szosa", "gravel"]);
  assert.deepEqual(R.goodTypesOf({}), ["full", "dirt", "elektryk_gorski"]);
  const words = R.ROAD_FILTER_KEYWORDS_DEFAULT.split(",").map(x => x.trim().toLowerCase());
  for (const bad of ["rennrad", "gravel", "rahmen", "carbon"]) assert.ok(!words.includes(bad), `filtr szos nie odrzuca słowa ${bad}`);
  for (const w of ["mountainbike", "stahlrahmen", "e-bike", "rahmenset", "zeitfahrrad", "laufradsatz", "vorderrad", "powermeter", "schuhe"]) assert.ok(words.includes(w), `filtr szos ma słowo ${w}`);
  const core = R.KB_ROAD.core;
  for (const t of ["karbon, hamulce szczękowe, Ultegra | 3400–4150 zł (≈780–955 €) | n=22", "gravel alu, tarczowe hydrauliczne, GRX 400 | 3400–3550 zł", "105 (10s 5700: 2010–2014; 11s 5800: 2014–2018", "WPIS MODELU A TABELA KATEGORII", "ROZPOZNAWANIE OSPRZĘTU NA ZDJĘCIACH", "ZNACZNIKI ROWERU SPRZED 2014"]) assert.ok(core.includes(t), `baza: ${t}`);
  const g = R.roadGroqPrompt({ title: "Canyon Endurace", desc: "Rennrad" });
  assert.ok(g.includes("szosa/gravel/inny/niepewne/stary") && g.includes("sprzed 2014") && !g.includes("elektryk_gorski"));
  const sp = R.buildRoadStaticPrefix({ notesSection: "", transportCostEur: 70, chatInfo: "" });
  assert.ok(sp.includes('"naped"') && sp.includes('"typ_roweru": "szosa" | "gravel" | "inny"') && sp.includes("minus koszt transportu do Polski 70€"));
  assert.ok(!sp.includes("PRZEDNIA PRZERZUTKA = ROWER STARY") && sp.includes("PRZEDNIA PRZERZUTKA I NAPĘD 2x to w szosie i gravelu norma"), "reguła przedniej przerzutki z MTB nie dotyczy szos");
});

await test("pole naped: normalizacja, etykieta, ostrzeżenia", async () => {
  const n = R.normalizeDrivetrain({ grupa: "Shimano 105 R7000", biegi: "2 x 11", zrodlo: "opis", hamulce: "szczekowe" });
  assert.deepEqual(n, { grupa: "Shimano 105 R7000", biegi: "2x11", zrodlo: "opis", hamulce: "szczekowe" });
  assert.equal(R.fmtDrivetrain(n), "Shimano 105 R7000 2x11 · szczękowe");
  assert.equal(R.drivetrainNeedsCheck(n), null);
  const u = R.normalizeDrivetrain({ grupa: "nieznana", biegi: "22 Gänge", zrodlo: "opis", hamulce: "cos" });
  assert.deepEqual(u, { grupa: null, biegi: null, zrodlo: "nieznany", hamulce: "nieznane" });
  assert.match(R.drivetrainNeedsCheck(u), /nie rozpoznano — liczona jak najtańsza/);
  assert.match(R.drivetrainNeedsCheck(R.normalizeDrivetrain({ grupa: "Shimano Ultegra", zrodlo: "wyglad", hamulce: "tarczowe_hydr" })), /tylko z wyglądu/);
  assert.match(R.drivetrainNeedsCheck(R.normalizeDrivetrain({ grupa: "Shimano Tiagra 4700", zrodlo: "opis" })), /rodzaj hamulców/);
  assert.equal(R.drivetrainField({ typ_roweru: "full", naped: n }).length, 0, "pole tylko dla szos / graveli");
  assert.equal(R.drivetrainField({ typ_roweru: "gravel", naped: n })[0].name, "⚙️ Napęd i hamulce");
  assert.deepEqual(R.normalizeDrivetrain(null), { grupa: null, biegi: null, zrodlo: "nieznany", hamulce: "nieznane" });
});

await test("wpisy marek i modeli: dobór do ogłoszenia, liczby zgodne z danymi OLX w docs/", async () => {
  const ids = Object.keys(R.KB_ROAD.chunks);
  assert.equal(ids.length, 15);
  assert.deepEqual(ids.slice().sort(), Object.keys(R.ROAD_BRAND_PATTERNS).sort(), "każdy wpis ma wzorzec marki");
  assert.ok(ids.every(id => id.startsWith("road_")), "id nie kolidują z bazą MTB");
  const sel = (t, label = "", desc = "") => R.selectRoadKbChunkIds([t, label, desc]);
  assert.deepEqual(sel("Canyon Endurace CF SL 8.0 Ultegra"), ["road_canyon"]);
  assert.deepEqual(sel("Rennrad Endurace AL 7.0"), ["road_canyon"], "sama nazwa modelu");
  assert.deepEqual(sel("CUBE Nuroad Race Gravel"), ["road_cube"]);
  assert.deepEqual(sel("Rennrad TCR Advanced 2"), ["road_giant"]);
  assert.deepEqual(sel("Émonda ALR 5"), ["road_trek"]);
  assert.deepEqual(sel("Specialized Allez Elite"), ["road_specialized"]);
  assert.deepEqual(sel("Cannondale CAAD12 105"), ["road_cannondale"]);
  assert.deepEqual(sel("Triban RC 520"), ["road_decathlon"]);
  assert.deepEqual(sel("Stevens Aspin Rennrad"), ["road_other"]);
  assert.deepEqual(sel("Rennrad Carbon 56 cm Ultegra"), [], "bez marki → tylko część ogólna");
  assert.deepEqual(sel("Rennrad 56 cm", "🚴 Cube Attain"), ["road_cube"], "marka z etykiety wyszukiwania, gdy tytuł jej nie ma");
  assert.deepEqual(sel("Scott Addict 20", "🚴 Canyon Ultimate"), ["road_scott"], "tytuł wygrywa z etykietą");
  assert.deepEqual(sel("Rennrad Größe M", "🚴 Rennrad Carbon", "Verkaufe mein Focus Izalco Race"), ["road_focus"], "marka z początku opisu");
  // każda liczba we wpisach pochodzi z danych w docs/ceny-szosy-olx-2026-11.md (p25–mediana, to samo n) i ma poprawne przeliczenie na euro
  const doc = fs.readFileSync(path.join(ROOT, "docs/ceny-szosy-olx-2026-11.md"), "utf8");
  const eur = (zl) => Math.round(zl / 4.35 / 5) * 5;
  let checked = 0;
  for (const txt of [...ids.map(id => R.KB_ROAD.chunks[id].text), R.KB_ROAD.core]) for (const line of txt.split("\n")) {
    const m = line.match(/\| (?:ok\. )?(\d+)(?:–(\d+))? zł \(≈(\d+)(?:–(\d+))? €\) \| n=(\d+)/);
    if (!m) continue;
    const lo = +m[1], hi = m[2] ? +m[2] : lo, n = +m[5];
    assert.ok(doc.includes(`n${n} ${lo}/${hi}/`) || doc.includes(`n=${n} all ${lo}/${hi}/`) || doc.includes(`n=${n} ${lo}/${hi}/`), `brak w danych: ${line.slice(0, 90)}`);
    assert.equal(+m[3], eur(lo), `euro (dół): ${line.slice(0, 70)}`); if (m[4]) assert.equal(+m[4], eur(hi), `euro (góra): ${line.slice(0, 70)}`);
    checked++;
  }
  assert.ok(checked >= 150, `sprawdzono ${checked} pasm`);
  assert.ok(R.KB_ROAD.chunks.road_canyon.text.includes("Canyon Endurace — karbon, hamulce szczękowe | 4500–5000 zł (≈1035–1150 €) | n=5 [niska pewność]"));
  assert.ok(R.KB_ROAD.chunks.road_cube.text.includes("Reguły Cube z bazy MTB (rocznik od 2020) NIE dotyczą szos i graveli"));
});

// ── Aplikacja (atrapy Kleinanzeigen / Groqa / AI / Discorda) ──
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const field = (e, s) => e.fields.find(x => x.name.includes(s))?.value;
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };          // karta MTB obecna od początku
const R0 = { id: "3000000001", title: "Canyon Endurace AL 6.0 alt", price: 600 };     // karta szosowa obecna od początku
const DESC = "Verkaufe mein Rennrad, Shimano Ultegra 6800 2x11, Felgenbremsen, Mavic Aksium Laufräder, Rahmenhöhe 56 cm, guter Zustand, kleine Gebrauchsspuren. Abholung in Köln.";
const isRoadGroq = (b) => /szosa\/gravel\/inny/.test(b.messages[0].content);
const TAK = { decyzja: "tak", cena_zakupu_eur: 500, szacowana_sprzedaz_eur: 950, przewidywany_zysk: 380,
  fakty: { rocznik: 2016, rocznik_zrodlo: "oszacowany", rocznik_zakres: "2014–2017", e_bike: false, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true } };
const NAPED = { grupa: "Shimano Ultegra 6800", biegi: "2x11", zrodlo: "opis", hamulce: "szczekowe" };
const run = async ({ roadCards = [], mtbCards = [], ai, cfg = {}, desc = DESC, groq, ls = {} } = {}) => {
  let phase = 1;
  const app = await openApp({ ls, cfg: { profitTiers: [27, 27, 27, 27], transportCostEur: 70, groqClassifierKey: "gsk_test", ...cfg },
    world: { detail: () => ({ desc, images: 3 }), ai: ai || ((b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 300, przewidywany_zysk: -100 }))),
      groq: groq || ((b) => groqResp(isRoadGroq(b) ? (/Tytuł: [^\n]*(Grail|Nuroad)/.test(b.messages[0].content) ? "gravel" : "szosa") : "full")),
      search: (k, n, st, url) => { (st.urls ||= []).push(url); return /Canyon Endurace/.test(url) ? [R0, ...(phase >= 2 ? roadCards : [])] : k === "torque" ? [A, ...(phase >= 2 ? mtbCards : [])] : []; } } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  return app;
};
const ROAD_ON = { roadEnabled: true, selectedRoad: ["road_canyon_endurace"] };

await test("domyślnie wyłączone: żadnych wyszukiwań szos, polecenie MTB bez bazy szos", async () => {
  const B = { id: "2000006141", title: "Canyon Torque AL 6.0 2019", price: 900 };
  const app = await run({ mtbCards: [B] });
  try {
    await app.waitUntil(() => genReqs(app.st).length >= 1, 20000, "analiza AI roweru MTB");
    assert.ok(!(app.st.urls || []).some(u => /Endurace|Gravel|Rennrad/.test(u)), "bez zapytań o szosy");
    assert.ok(app.st.urls.some(u => /preis:200:1400\/Canyon Torque\/k0c217\+fahrraeder\.type_s:\(ebike,mountainbike\)/.test(u)), "link MTB bez zmian");
    const p = promptOf(genReqs(app.st)[0]);
    assert.ok(p.startsWith("Jesteś ekspertem od rowerów dirtowych, MTB full-suspension i e-MTB górskich."), "część stała MTB");
    assert.ok(!p.includes("BAZA CEN SZOS I GRAVELI") && !p.includes('"naped"'), "MTB nie dostaje bazy ani pól szos");
    assert.ok(app.st.groqReqs.every(b => !isRoadGroq(b)), "Groq: tylko polecenie MTB");
    assert.match(await app.text(), /Szosy i gravele — wyłączone/);
    assert.equal(JSON.parse(await app.ls("ddf_cfg")).roadEnabled, undefined, "ustawienia nietknięte");
  } finally { await close(app); }
});

await test("włączone: link 200–800 € bez filtra typu, Groq i analiza z toru szos, alert 🚴 z napędem; gravel osobno", async () => {
  const S = { id: "3000006141", title: "Canyon Endurace CF SL 8.0 Ultegra Carbon Rennrad", price: 500 };
  const G = { id: "3000006142", title: "Canyon Grail AL 7.0 GRX Gravel", price: 500 };
  const ai = (b) => { if (b.action) return {}; const g = /Tytuł: Canyon Grail/.test(promptOf(b));
    return geminiResp(analysisJson({ ...TAK, typ_roweru: g ? "gravel" : "szosa", naped: g ? { grupa: "Shimano GRX RX600", biegi: "2x11", zrodlo: "napis", hamulce: "tarczowe_hydr" } : NAPED,
      rama: { material: g ? "alu" : "karbon", zrodlo: "tekst", dowod: null, sprzedaz_alu_eur: null } }), { imagesAttached: b.imageUrls?.length || 0 }); };
  const app = await run({ roadCards: [S, G], ai, cfg: ROAD_ON });
  try {
    await app.waitUntil(() => deals(app.st).length >= 2, 30000, "dwie okazje (szosa i gravel)");
    const roadUrls = app.st.urls.filter(u => /Canyon Endurace/.test(u));
    assert.ok(roadUrls.length >= 2 && roadUrls.every(u => u === "https://www.kleinanzeigen.de/s-fahrraeder/anzeige:angebote/preis:200:800/Canyon Endurace/k0c217"), `link szos: ${roadUrls[0]}`);
    assert.ok(app.st.urls.some(u => /Canyon Torque\/k0c217\+fahrraeder\.type_s:\(ebike,mountainbike\)/.test(u) && /preis:200:1400/.test(u)), "link MTB dalej 200–1400 € z filtrem typu");
    assert.ok(app.st.groqReqs.some(isRoadGroq), "Groq dostał polecenie szos");
    const first = promptOf(genReqs(app.st).find(b => /Tytuł: Canyon Endurace CF SL/.test(promptOf(b))));
    assert.ok(first.startsWith("Jesteś ekspertem od rowerów szosowych, graveli i przełajówek."), "część stała szos");
    assert.ok(first.includes("BAZA CEN SZOS I GRAVELI") && !first.includes("WIDELEC W DIRCIE") && !first.includes("PRZEDNIA PRZERZUTKA = ROWER STARY"));
    assert.ok(first.includes("BAZA CEN — WPISY DLA TEGO OGŁOSZENIA (dobrane automatycznie po marce / typie: Canyon (szosa / gravel))") && first.includes("Canyon Ultimate — karbon, hamulce szczękowe | 3950–5500 zł"), "wpis marki w poleceniu");
    assert.ok(!first.includes("CUBE (SZOSA / GRAVEL)") && !first.includes("=== BAZA CEN — brak wpisu marki"), "tylko wpis właściwej marki");
    assert.ok(first.includes('sklasyfikowane (Etap 1) jako typ: "szosa"') && first.includes("ZASADA ROCZNIKA I PASMA (pierwsza analiza)") && first.includes("Materiał ramy z tekstu"));
    assert.ok(genReqs(app.st).some(b => promptOf(b).includes("TRYB WERYFIKACJI") && promptOf(b).includes("1. GRUPA OSPRZĘTU")), "weryfikacja z listą dla szos");
    const es = deals(app.st).map(d => d.payload.embeds[0]);
    const szosa = es.find(e => /Endurace/.test(e.title)), gravel = es.find(e => /Grail/.test(e.title));
    assert.match(szosa.title, /^🚴 OKAZJA — SZOSA: /); assert.match(gravel.title, /^🚴 OKAZJA — GRAVEL: /);
    assert.equal(field(szosa, "Napęd i hamulce"), "Shimano Ultegra 6800 2x11 · szczękowe");
    assert.equal(field(gravel, "Napęd i hamulce"), "Shimano GRX RX600 2x11 (napis na zdjęciu) · tarczowe hydrauliczne");
    assert.match(field(szosa, "Typ roweru"), /Szosa/); assert.match(field(szosa, "Rocznik") || "", /2014–2017/);
    assert.equal(field(szosa, "Widelec"), undefined, "bez pola widelca w szosie");
    const seen = JSON.parse(await app.ls("ddf_seen"));
    assert.equal(seen.find(x => x.id === S.id)?.pf, "r"); assert.equal(seen.find(x => x.id === A.id)?.pf, undefined);
  } finally { await close(app); }
});

await test("filtry toru szos: własne słowa, limit 800 €, rocznik od 2014 (MTB dalej 2017 i własne słowa)", async () => {
  const cards = [
    { id: "3000006151", title: "Peugeot Rennrad Stahlrahmen 58", price: 300 },
    { id: "3000006152", title: "Canyon Endurace CF SLX Disc", price: 900 },
    { id: "3000006153", title: "Canyon Endurace CF 2012 Ultegra", price: 500 },
    { id: "3000006154", title: "Canyon Endurace AL 2015 Shimano 105 Rennrad", price: 450 },
  ];
  const mtb = [{ id: "2000006151", title: "Canyon Torque Rennrad Umbau", price: 900 }, { id: "2000006152", title: "Canyon Torque 2015", price: 900 }];
  const app = await run({ roadCards: cards, mtbCards: mtb, cfg: ROAD_ON, ai: (b) => b.action ? {} : geminiResp(analysisJson({ typ_roweru: "szosa", decyzja: "nie", cena_zakupu_eur: 450, szacowana_sprzedaz_eur: 500, przewidywany_zysk: -20, naped: NAPED })) });
  try {
    await app.waitLog(/Filtr: odrzucono \(słowo: "stahlrahmen"\) — Peugeot Rennrad/, 20000);
    await app.waitLog(/odrzucono \(cena 900€ powyżej limitu zakupu 800€\) — Canyon Endurace CF SLX Disc/);
    await app.waitLog(/Filtr roku: odrzucono \(rok 2012 < 2014\) — Canyon Endurace CF 2012/);
    await app.waitLog(/Filtr: odrzucono \(słowo: "rennrad"\) — Canyon Torque Rennrad Umbau/);
    await app.waitLog(/Filtr roku: odrzucono \(rok 2015 < 2017\) — Canyon Torque 2015/);
    await app.waitUntil(() => genReqs(app.st).some(b => /Tytuł: Canyon Endurace AL 2015/.test(promptOf(b))), 20000, "szosa 2015 trafia do analizy");
    assert.equal(await app.countLogs(/odrzucono.*Canyon Endurace AL 2015/), 0);
  } finally { await close(app); }
});

await test("twarde reguły toru szos: silnik → odrzucone, rocznik < 2014 od AI → stary, grupa nierozpoznana → ostrzeżenie", async () => {
  const E = { id: "3000006161", title: "Canyon Endurace ON Rennrad", price: 600 };
  const O = { id: "3000006162", title: "Canyon Endurace CF Ultegra Rennrad", price: 400 };
  const U = { id: "3000006163", title: "Canyon Endurace AL Rennrad RH 56", price: 300 };
  const ai = (b) => { if (b.action) return {}; const p = promptOf(b);
    if (/Tytuł: Canyon Endurace ON/.test(p)) return geminiResp(analysisJson({ ...TAK, typ_roweru: "szosa", naped: NAPED, fakty: { ...TAK.fakty, e_bike: true } }));
    if (/Tytuł: Canyon Endurace CF Ultegra/.test(p)) return geminiResp(analysisJson({ ...TAK, typ_roweru: "szosa", naped: NAPED, fakty: { ...TAK.fakty, rocznik: 2012, rocznik_zakres: "2011–2013" } }));
    return geminiResp(analysisJson({ ...TAK, typ_roweru: "szosa", cena_zakupu_eur: 300, szacowana_sprzedaz_eur: 600, przewidywany_zysk: 230, naped: { grupa: "nieznana", zrodlo: "nieznany", hamulce: "szczekowe" } }), { imagesAttached: b.imageUrls?.length || 0 }); };
  const app = await run({ roadCards: [E, O, U], ai, cfg: ROAD_ON });
  try {
    await app.waitLog(/NIE opłaca się \(e-bike[^)]*\) — \[szosa\] Canyon Endurace ON/, 30000);
    await app.waitLog(/NIE opłaca się \(rocznik 2012 sprzed 2014\) — \[szosa\] Canyon Endurace CF Ultegra/, 30000);
    await app.waitUntil(() => deals(app.st).length >= 1, 30000, "okazja z nierozpoznaną grupą");
    const e = deals(app.st)[0].payload.embeds[0];
    assert.match(e.title, /Canyon Endurace AL Rennrad RH 56/);
    assert.match(field(e, "Do sprawdzenia") || "", /sprawdź grupę osprzętu \(nie rozpoznano — liczona jak najtańsza\)/);
    assert.equal(field(e, "Napęd i hamulce"), "grupa nierozpoznana · szczękowe");
    await app.page.waitForTimeout(1300); // wyniki zapisują się z opóźnieniem 1 s
    const res = JSON.parse(await app.ls("ddf_results"));
    assert.match(res.find(r => r.listing.listingId === E.id)?.analysis?.krotki_opis || "", /Rower z silnikiem — elektryczne szosy i gravele są odrzucane/);
    assert.equal(res.find(r => r.listing.listingId === E.id)?.listing?.profile, "road", "tor zapisany w wynikach");
  } finally { await close(app); }
});

await test("osobny kanał Discorda dla okazji szos (gdy ustawiony)", async () => {
  const S = { id: "3000006171", title: "Canyon Endurace CF SL 7.0 Carbon", price: 500 };
  const app = await run({ roadCards: [S], cfg: { ...ROAD_ON, roadWebhook: "https://discord.com/api/webhooks/9/road" },
    ai: (b) => b.action ? {} : geminiResp(analysisJson({ ...TAK, typ_roweru: "szosa", naped: NAPED }), { imagesAttached: b.imageUrls?.length || 0 }) });
  try {
    await app.waitUntil(() => deals(app.st).length >= 1, 30000, "okazja");
    assert.equal(deals(app.st)[0].webhookUrl, "https://discord.com/api/webhooks/9/road");
  } finally { await close(app); }
});

await test("przełącznik: klik zapisuje ustawienie i pokazuje listę wyszukiwań; wyłączenie czyści kolejkę z ofert szos", async () => {
  const job = { listing: { listingId: "3000006181", title: "Canyon Ultimate CF SL", price: 500, href: "https://www.kleinanzeigen.de/s-anzeige/x/3000006181-217-1234", desc: "", location: "", bike: "🚴 Canyon Ultimate", profile: "road" },
    source: "new", cachedType: null, stage: "analyze", groqType: "szosa", classifierDown: false, attempts: 0, addedAt: Date.now() };
  const app = await openApp({ ls: { ddf_pending: [job] }, cfg: { groqClassifierKey: "gsk_test" },
    world: { search: () => [], ai: () => { throw new Error("AI nie powinno być wołane"); } } });
  try {
    assert.equal(await app.page.locator("[data-testid=road-toggle]").isChecked(), false);
    await app.start();
    await app.waitLog(/Szosy i gravele wyłączone — usunięto z kolejki 1 ofert/);
    assert.equal(genReqs(app.st).length, 0);
    await close(app).catch(() => {});
  } catch (e) { await app.close().catch(() => {}); throw e; }
  const app2 = await openApp({ cfg: {}, world: { search: () => [], ai: () => ({}) } });
  try {
    await app2.page.locator("[data-testid=road-toggle]").check();
    await app2.page.waitForTimeout(900);
    const cfg = JSON.parse(await app2.ls("ddf_cfg"));
    assert.equal(cfg.roadEnabled, true); assert.equal(cfg.roadMaxBuyPrice, 800); assert.equal(cfg.selectedRoad.length, R.ROAD_SEARCHES.length);
    assert.match(await app2.text(), /Szosy i gravele — WŁĄCZONE/);
    assert.match(await app2.text(), /Canyon Endurace/);
    await app2.page.getByRole("button", { name: "żadne", exact: true }).click();
    await app2.page.waitForTimeout(900);
    assert.equal(JSON.parse(await app2.ls("ddf_cfg")).selectedRoad.length, 0);
  } finally { await app2.close(); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
