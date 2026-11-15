import { openApp, closeBrowser, analysisJson, geminiResp, groqResp } from "./harness.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
// v6.18: SZOSY I GRAVELE — poprawki po teście na 780 prawdziwych ogłoszeniach z Kleinanzeigen (15.11.2026):
// filtr słów (same części i rowery uszkodzone), „tak” tylko z ustalonym rocznikiem, dowody rocznika i starsze generacje w bazie.
// Tytuły w testach to prawdziwe tytuły ogłoszeń z tego dnia.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const blk = src.match(/\/\/ ==ROAD_START==[\s\S]*?\/\/ ==ROAD_END==/);
const R = new Function(`const EUR_PLN_RATE = 4.35;\n${blk[0]}\nreturn { KB_ROAD, roadGroqPrompt, buildRoadStaticPrefix, roadVerifyNote, ROAD_FILTER_KEYWORDS_DEFAULT, ROAD_FILTER_KEYWORDS_V616 };`)();
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }

await test("baza i polecenia: dowód rocznika 2014+, starsze generacje, hamulce Magura, rama alu z karbonowymi wstawkami", async () => {
  assert.equal(R.KB_ROAD.version, "11.2026-e3");
  const core = R.KB_ROAD.core;
  for (const t of ["DOWÓD ROCZNIKA 2014+ (bez niego nie ma decyzji „tak”)", "napęd 11- albo 12-rzędowy (11-fach, 2x11, 22 Gänge, 1x11, 1x12)", "Ultegra / 105 / Dura-Ace z kasetą 9- albo 10-rzędową",
    "STARSZE GENERACJE", "Rose: „Red Bull”", "Giant: TCR Composite", "Magura RT6 / RT8 / HS", "rama ALU z karbonowymi wstawkami", "Sensah, L-Twoo, microSHIFT na ramie z wyższej półki"]) assert.ok(core.includes(t), `baza: ${t}`);
  const sp = R.buildRoadStaticPrefix({ notesSection: "", transportCostEur: 70, chatInfo: "" });
  assert.ok(sp.includes('I rocznik 2014+ ma dowód') && sp.includes('"rocznik": null — program skieruje ofertę do niepewnych'));
  const g = R.roadGroqPrompt({ title: "x", desc: "y" });
  for (const t of ["9-fach, 10-fach, 2x9, 3x9, 2x10, 3x10", "Rose „Red Bull”", "Canyon Ultimate F10", "es wird lediglich / nur der Rahmen verkauft", "„60er Rahmen”"]) assert.ok(g.includes(t), `Groq: ${t}`);
  const v = R.roadVerifyNote({ fk: {}, current: {}, photosN: 0, typeConflictNote: "", frameMaterial: null });
  assert.ok(v.includes("czy jest DOWÓD rocznika 2014+") && v.includes("Sama nazwa grupy bez numeru serii i liczby biegów NIE wystarcza"));
  const words = R.ROAD_FILTER_KEYWORDS_DEFAULT.split(",").map(x => x.trim().toLowerCase());
  for (const w of ["sattelstütze", "lenker", "vorbau", "carbonrahmen", "rahmen set", "rahmen-set", "rennrad-rahmen", "rahmen defekt", "rahmenbruch", "teilesatz", "defekt", "bastler", "gabel für", "freilauf"]) assert.ok(words.includes(w), `nowe słowo: ${w}`);
  for (const bad of ["rahmen", "gabel", "rennrad", "gravel", "carbon"]) assert.ok(!words.includes(bad), `filtr nie ma samego słowa ${bad}`);
  assert.ok(R.ROAD_FILTER_KEYWORDS_V616.length > 500 && R.ROAD_FILTER_KEYWORDS_V616 !== R.ROAD_FILTER_KEYWORDS_DEFAULT && !R.ROAD_FILTER_KEYWORDS_V616.includes("Sattelstütze"));
});

// ── Aplikacja ──
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const R0 = { id: "3000000001", title: "Canyon Endurace AL 6.0 alt", price: 600 };
const DESC = "Verkaufe mein Rennrad, Shimano Ultegra, Felgenbremsen, Mavic Aksium Laufräder, Rahmenhöhe 56 cm, guter Zustand.";
const NAPED = { grupa: "Shimano Ultegra", biegi: null, zrodlo: "opis", hamulce: "szczekowe" };
const run = async ({ roadCards = [], ai, cfg = {}, groq } = {}) => {
  let phase = 1;
  const app = await openApp({ cfg: { profitTiers: [27, 27, 27, 27], transportCostEur: 70, groqClassifierKey: "gsk_test", roadEnabled: true, selectedRoad: ["road_canyon_endurace"], ...cfg },
    world: { detail: () => ({ desc: DESC, images: 3 }), ai: ai || ((b) => b.action ? {} : geminiResp(analysisJson({ typ_roweru: "szosa", decyzja: "nie", szacowana_sprzedaz_eur: 300, przewidywany_zysk: -100, naped: NAPED }))),
      groq: groq || (() => groqResp("szosa")),
      search: (k, n, st, url) => /Canyon Endurace/.test(url) ? [R0, ...(phase >= 2 ? roadCards : [])] : k === "torque" ? [A] : [] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  return app;
};
const card = (i, title, price = 400) => ({ id: String(3000006180 + i), title, price });

await test("filtr słów na prawdziwych tytułach: same części i uszkodzone odpadają, całe rowery z „Rahmen” / „Gabel” przechodzą", async () => {
  const junk = [
    ["Giant D-Fuse Carbon Sattelstütze 395 mm | NEU | Defy Revolt TCX", "sattelstütze"], ["Cube Litening Aero Carbon Lenker 420/120mm", "lenker"],
    ["Giant Revolt 1 mit Rahmenbruch aus 2022 als Teilesatz", "rahmenbruch"], ["Canyon Grizl CF SL7 (Rahmen defekt)", "rahmen defekt"],
    ["Gabel für Canyon Ultimate", "gabel für"], ["Carbonrahmen eines Gravelbike Rose Backroad Rahmenhöhe 57cm", "carbonrahmen"],
    ["Cannondale Synapse Carbon 58 Rahmen Set", "rahmen set"], ["Cannondale SuperSix EVO Carbon Rennrad-Rahmen 58 L/XL", "rennrad-rahmen"],
    ["Cannondale SuperSix Evo 2024 51 cm Defekt", "defekt"], ["Cube Nuroad Race 2026 FE Gravelbike XL- Defekt für Bastler", "bastler|defekt"],
  ];
  const ok = ["Cube Attain Pro Rennrad schwarz/orange 60er Rahmen", "TREK Emonda ALR 4, Rennrad 28\", 56 cm Rahmen", "ROSE Pro SL 3000 Rennrad RH 61, Alu-Rahmen, Carbon-Gabel, Ultegra", "Specialized Allez Expert Rennrad 61cm Carbon Gabel Ultegra"];
  const app = await run({ roadCards: [...junk.map(([t], i) => card(i, t)), ...ok.map((t, i) => card(20 + i, t))] });
  try {
    await app.waitUntil(() => ok.every(t => genReqs(app.st).some(b => promptOf(b).includes(`Tytuł: ${t}`))), 30000, "całe rowery trafiają do analizy");
    for (const [t, w] of junk) assert.equal(await app.countLogs(new RegExp(`Filtr: odrzucono \\(słowo: "(${w})"\\) — ${t.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)), 1, `odrzucone słowem: ${t}`);
    for (const t of ok) assert.equal(await app.countLogs(new RegExp(`odrzucono.*${t.slice(0, 25).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)), 0, `nie odrzucone: ${t}`);
    assert.ok(junk.every(([t]) => !app.st.groqReqs.some(b => b.messages[0].content.includes(t))), "części nie idą nawet do Groqa");
  } finally { await close(app); }
});

await test("zapisana lista słów z v6.16 jest podmieniana na nową; własna lista użytkownika zostaje", async () => {
  const S = card(40, "Syncros Sattelstütze SP-R101-CF Carbon 15mm Offset Scott Addict");
  const app = await run({ roadCards: [S], cfg: { roadFilterKeywords: R.ROAD_FILTER_KEYWORDS_V616 } });
  try { await app.waitLog(/Filtr: odrzucono \(słowo: "sattelstütze"\) — Syncros Sattelstütze/, 20000); } finally { await close(app); }
  const app2 = await run({ roadCards: [S], cfg: { roadFilterKeywords: "Fixie, Tandem" } });
  try {
    await app2.waitUntil(() => app2.st.groqReqs.some(b => b.messages[0].content.includes("Syncros Sattelstütze")), 20000, "własna lista: tytuł idzie do Groqa");
    assert.equal(await app2.countLogs(/Filtr: odrzucono.*Syncros/), 0);
  } finally { await close(app2); }
});

await test("„tak” bez ustalonego rocznika → niepewne (nie okazja); z rocznikiem 2014+ → okazja", async () => {
  const NOYEAR = card(50, "Cube Litening Super HPC Carbon Rennrad Ultegra Größe 62", 499);
  const YEAR = card(51, "Canyon Endurace CF SL 8.0 Ultegra 2x11 Carbon", 500);
  const base = { typ_roweru: "szosa", decyzja: "tak", cena_zakupu_eur: 500, szacowana_sprzedaz_eur: 900, przewidywany_zysk: 330, naped: NAPED, rama: { material: "karbon", zrodlo: "tekst", dowod: null, sprzedaz_alu_eur: null } };
  const ai = (b) => { if (b.action) return {}; const noYear = /Tytuł: Cube Litening Super HPC/.test(promptOf(b));
    return geminiResp(analysisJson({ ...base, cena_zakupu_eur: noYear ? 499 : 500, fakty: { rocznik: noYear ? null : 2016, rocznik_zrodlo: noYear ? "brak" : "oszacowany", rocznik_zakres: noYear ? null : "2014–2018", e_bike: false, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true } }), { imagesAttached: b.imageUrls?.length || 0 }); };
  const app = await run({ roadCards: [NOYEAR, YEAR], ai });
  try {
    await app.waitLog(/„tak” bez dowodu rocznika 2014\+ → „niepewne” — Cube Litening Super HPC/, 30000);
    await app.waitUntil(() => deals(app.st).length >= 1, 30000, "okazja z rocznikiem");
    await app.page.waitForTimeout(1500);
    assert.equal(deals(app.st).length, 1, "tylko rower z rocznikiem jest okazją");
    assert.match(deals(app.st)[0].payload.embeds[0].title, /Canyon Endurace CF SL 8\.0/);
    const res = JSON.parse(await app.ls("ddf_results"));
    const r = res.find(x => x.listing.listingId === NOYEAR.id);
    assert.equal(r.analysis.decyzja, "niepewne"); assert.equal(r.analysis.niepewne_kategoria, "za_malo_opisu");
    assert.match(r.analysis.ostrzezenia || "", /brak dowodu rocznika 2014\+/);
  } finally { await close(app); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
