import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.15: duplikat przy poprawionym tytule (ten sam sprzedawca, cena i opis) · rocznik: nazwa modelu jako dolna granica
// (Cube Stereo ONE44 od 2023) i środkowy rok zakresu liczony przez program · „Bj. 2015 / 29”, „Baujahr 2014 - 27 Gänge”
// to nie lata 2029 / 2027 · nocne szukanie ogłoszeń powyżej limitu zakupu (pula „za drogich” znowu rośnie)
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const titledReq = (st, t) => genReqs(st).some(b => promptOf(b).includes(t));
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque alt", price: 1000 };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
const aiBy = (first, ver = first) => (b) => b.action ? {} : geminiResp(analysisJson(isVer(b) ? ver : first), { imagesAttached: b.imageUrls?.length || 0 });
// faza 1: sama oferta A (zapamiętanie); faza 2: A + nowe oferty
const run = async (Bs, world, { cfg = {}, waitAi = true } = {}) => {
  let phase = 1;
  const app = await openApp({ cfg: { profitTiers: [27, 27, 27, 27], transportCostEur: 70, ...cfg }, world: { detail: () => ({ desc: GOOD, images: 6 }), ...world,
    search: (k) => k === "torque" ? [A, ...(phase >= 2 ? Bs : [])] : [] } });
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
const FAKTY = (rocznik, zakres = null, zrodlo = "oszacowany") => ({ rocznik, rocznik_zrodlo: zrodlo, rocznik_zakres: zakres, e_bike: false, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true });
const DEAL = { cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 530, decyzja: "tak" };
const NO = { cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 950, przewidywany_zysk: -20, decyzja: "nie" };

// ── 1. Duplikat przy zmienionym tytule ──
await test("Ten sam sprzedawca, cena i opis, poprawiona literówka w tytule (nowe zdjęcia) → duplikat: bez drugiej analizy i drugiego alertu", async () => {
  const B1 = { id: "2000006151", title: "Santa Cruz Bronsok v4 CC Größe L", price: 900 };
  const B2 = { id: "2000006152", title: "Santa Cruz Bronson v4 CC Größe L", price: 900 };
  const detail = (id) => ({ desc: GOOD, images: 4, imgSet: id === B1.id ? "a1" : "a2", seller: "127759859" });
  const app = await run([B1, B2], { detail, ai: aiBy(DEAL) });
  try {
    await app.waitLog(/Duplikat ogłoszenia 200000615[12] \(ten sam sprzedawca, cena i opis, zmieniony tytuł\) — bez analizy AI/, 25000);
    await app.waitLog(/Cykl #2 zakończony/, 30000); await app.waitQueueEmpty();
    assert.equal(deals(app.st).length, 1, "jeden alert");
    assert.equal(genReqs(app.st).filter(b => !isVer(b)).length, 1, "jedna pierwsza analiza");
    assert.equal(genReqs(app.st).filter(isVer).length, 1, "jedna weryfikacja");
  } finally { await close(app); }
});

await test("Ten sam sprzedawca i cena, podobny tytuł, ale inny opis i zdjęcia (np. drugi rozmiar) → obie analizowane, druga z ostrzeżeniem", async () => {
  const B1 = { id: "2000006153", title: "Canyon Torque CF 8 Größe M", price: 900 };
  const B2 = { id: "2000006154", title: "Canyon Torque CF 8 Größe L", price: 900 };
  const detail = (id) => id === B1.id ? { desc: GOOD, images: 4, imgSet: "b1", seller: "555" } : { desc: GOOD + " Zweiter Satz Reifen dabei, neue Kette.", images: 4, imgSet: "b2", seller: "555" };
  const app = await run([B1, B2], { detail, ai: aiBy(DEAL) });
  try {
    await app.waitUntil(() => deals(app.st).length >= 2, 30000, "dwa alerty");
    assert.equal(await app.countLogs(/Duplikat ogłoszenia/), 0, "bez pewnego duplikatu");
    const warn = [await resultOf(app, B1.id), await resultOf(app, B2.id)].map(a => String(a.ostrzezenia || ""));
    assert.ok(warn.some(w => /możliwy duplikat ogłoszenia 200000615[34] \(ten sam sprzedawca i cena, podobny tytuł\)/.test(w)), `ostrzeżenie o możliwym duplikacie: ${warn.join(" | ")}`);
  } finally { await close(app); }
});

await test("Ten sam sprzedawca, cena i opis, ale zupełnie inny tytuł → dwa różne rowery", async () => {
  const B1 = { id: "2000006155", title: "Canyon Torque CF 8 Größe M", price: 900 };
  const B2 = { id: "2000006156", title: "Trek Slash 9.8 Carbon 29 Zoll", price: 900 };
  const detail = (id) => ({ desc: GOOD, images: 4, imgSet: id === B1.id ? "c1" : "c2", seller: "556" });
  const app = await run([B1, B2], { detail, ai: aiBy(DEAL) });
  try {
    await app.waitUntil(() => deals(app.st).length >= 2, 30000, "dwa alerty");
    assert.equal(await app.countLogs(/Duplikat ogłoszenia/), 0);
  } finally { await close(app); }
});

// ── 2. Rocznik ──
await test("Cube Stereo ONE44: oszacowany 2020 (zakres 2020–2024) → liczony 2023, prompt podaje regułę nazwy", async () => {
  const B = { id: "2000006157", title: "Cube Stereo ONE44 C:62 Pro 29", price: 900 };
  const app = await run([B], { ai: aiBy({ ...NO, fakty: FAKTY(2020, "2020–2024") }) });
  try {
    assert.match(promptOf(genReqs(app.st)[0]), /Nazwa modelu Cube Stereo ONE44 \/ ONE55 istnieje dopiero od rocznika 2023/);
    assert.ok(await app.countLogs(/Oszacowany rocznik 2020 \(zakres 2020–2024\), ale Cube Stereo ONE44 \/ ONE55 istnieje od 2023 — liczę 2023/) >= 1, "log");
    const a = await resultOf(app, B.id);
    assert.equal(a.fakty.rocznik, 2023);
    assert.equal(a.fakty.rocznik_zakres, "2023–2024");
  } finally { await close(app); }
});

await test("Cube Stereo ONE55 z oszacowanym rocznikiem 2019 bez zakresu → nie jest odrzucany jako Cube sprzed 2020", async () => {
  const B = { id: "2000006158", title: "Cube Stereo ONE55 C:62 Race", price: 900 };
  const app = await run([B], { ai: aiBy({ ...DEAL, fakty: FAKTY(2019) }) });
  try {
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja");
    assert.equal((await resultOf(app, B.id)).odrzucenie ?? null, null);
  } finally { await close(app); }
});

await test("Zwykły Cube Stereo 150 z oszacowanym 2019 bez zakresu → dalej „nie” (reguła nazwy go nie dotyczy)", async () => {
  const B = { id: "2000006159", title: "Cube Stereo 150 C:62 Race 29", price: 900 };
  const app = await run([B], { ai: aiBy({ ...DEAL, fakty: FAKTY(2019) }) });
  try {
    assert.equal((await resultOf(app, B.id)).odrzucenie, "stary_oszac");
    assert.equal(deals(app.st).length, 0);
    assert.ok(!promptOf(genReqs(app.st)[0]).includes("istnieje dopiero od rocznika"), "bez reguły nazwy w prompcie");
  } finally { await close(app); }
});

await test("Pierwsza analiza: oszacowany 2018 przy zakresie 2018–2022 → program liczy środkowy 2020; weryfikacja zostaje przy swoim roku", async () => {
  const B = { id: "2000006160", title: "Canyon Torque CF 7", price: 900 };
  let app = await run([B], { ai: aiBy({ ...NO, fakty: FAKTY(2018, "2018–2022") }) });
  try {
    assert.ok(await app.countLogs(/Oszacowany rocznik 2018 przy zakresie 2018–2022 — liczę środkowy 2020/) >= 1, "log");
    assert.equal((await resultOf(app, B.id)).fakty.rocznik, 2020);
  } finally { await close(app); }
  const C = { id: "2000006161", title: "Canyon Torque CF 9", price: 900 };
  app = await run([C], { ai: aiBy({ ...DEAL, fakty: FAKTY(2018, "2018–2022") }) });
  try {
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja");
    assert.equal(await app.countLogs(/liczę środkowy 2020/), 1, "tylko pierwsza analiza");
    assert.equal((await resultOf(app, C.id)).fakty.rocznik, 2018, "weryfikator: najstarszy pasujący rok");
  } finally { await close(app); }
});

await test("Rok wyższy od środka zakresu (np. 2021 przy 2018–2022) zostaje bez zmian", async () => {
  const B = { id: "2000006162", title: "Canyon Torque CF 6", price: 900 };
  const app = await run([B], { ai: aiBy({ ...NO, fakty: FAKTY(2021, "2018–2022") }) });
  try {
    assert.equal(await app.countLogs(/liczę środkowy/), 0);
    assert.equal((await resultOf(app, B.id)).fakty.rocznik, 2021);
  } finally { await close(app); }
});

// ── 3. „Bj. 2015 / 29” i „Baujahr 2014 - 27 Gänge” ──
await test("Tytuł „Bj. 2015 / 29” i „Baujahr 2014 - 27 Gänge” → rok 2015 / 2014, odrzucone bez AI; „Bj. 2016/17” → 2017, do analizy", async () => {
  const B = [
    { id: "2000006163", title: "Canyon Torque Bj. 2015 / 29", price: 900 },
    { id: "2000006164", title: "Canyon Torque Baujahr 2014 - 27 Gänge", price: 900 },
    { id: "2000006165", title: "Canyon Torque Bj. 2016/17", price: 900 },
  ];
  const app = await run(B, { ai: aiBy(NO) });
  try {
    await app.waitUntil(() => titledReq(app.st, B[2].title), 20000, "analiza 2016/17");
    await app.waitQueueEmpty();
    assert.ok(!titledReq(app.st, B[0].title), "„Bj. 2015 / 29” bez AI");
    assert.ok(!titledReq(app.st, B[1].title), "„Baujahr 2014 - 27 Gänge” bez AI");
    assert.ok(await app.countLogs(/rok 2015 < 2017/) >= 1, "log 2015");
    assert.ok(await app.countLogs(/rok 2014 < 2017/) >= 1, "log 2014");
    assert.equal(await app.countLogs(/rok 2016 < 2017/), 0, "2016/17 liczone jako 2017");
  } finally { await close(app); }
});

await test("Opis „Baujahr 2014 - 27 Gänge” → rocznik 2014 z opisu, odrzucone bez AI", async () => {
  const B = { id: "2000006166", title: "Canyon Torque AL gepflegt", price: 900 };
  const app = await run([B], { detail: () => ({ desc: "Baujahr 2014 - 27 Gänge, Scheibenbremsen. " + GOOD, images: 4 }), ai: aiBy(DEAL) }, { waitAi: false });
  try {
    assert.equal(genReqs(app.st).length, 0, "bez analizy AI");
    assert.equal(deals(app.st).length, 0);
  } finally { await close(app); }
});

// ── 4. Nocne szukanie „za drogich” ──
await test("Noc: wyszukiwania powyżej limitu zakupu → nowe „za drogie” zapamiętane bez AI, znane dostają cenę z karty, raz na noc", async () => {
  const old = Date.now() - 3 * 24 * 3600e3;
  const X = { id: "2000006171", title: "Canyon Torque CF teuer bekannt", price: 1550 };   // znane „za drogie”, dalej za drogie — bez strony ogłoszenia
  const N = { id: "2000006172", title: "Canyon Torque CF 9 neu teuer", price: 1700 };     // nowe powyżej limitu
  const P = { id: "2000006173", title: "Canyon Torque AL wyróżnione", price: 900 };       // wyróżnione spoza zakresu cen — ignorowane
  const F = { id: "2000006174", title: "Canyon Torque CFR sehr teuer", price: 2600 };     // powyżej górnej granicy — ignorowane
  const D = { id: "2000006175", title: "Dirt Jump Bike teuer", price: 1500 };
  const seen = [
    { id: A.id, price: 1000, lowest: 1000, type: "full", lastSeenAt: Date.now() },         // zwykła, już oceniona oferta
    { id: X.id, price: 1600, lowest: 1600, overMax: true, lastSeenAt: old },
    { id: "2000006176", price: 1500, lowest: 1500, overMax: true, lastSeenAt: old },        // nie ma go na liście → strona ogłoszenia
  ];
  const overUrls = [];
  const search = (k, n, st, url) => {
    if (/preis:1401:2100\//.test(url)) { overUrls.push(url); return k === "torque" ? [X, N, P, F] : [D]; }
    return k === "torque" ? [A] : [];
  };
  const app = await openApp({ cfg: { nightCheckHour: new Date().getHours(), selectedBikes: ["canyon_torque", "dirt_search"] }, ls: { ddf_seen: seen },
    world: { search, detail: () => ({ desc: GOOD, price: 1500, title: "Canyon Torque CF Nacht" }), ai: aiBy(NO) } });
  try {
    await app.start();
    await app.waitLog(/Nocne szukanie „za drogich”: 3 wyszukiwań w cenie 1401–2100 €/, 15000); // „Dirt” dobiera też „Dirtbike”
    await app.waitLog(/Nocne szukanie „za drogich” zakończone: 2 nowych ogłoszeń w pamięci \(3 wyszukiwań\)/, 20000);
    await app.waitLog(/Nocne sprawdzanie cen: 1 ogłoszeń/, 20000);
    await app.waitLog(/Nocne sprawdzanie cen zakończone: sprawdzono 1\/1/, 20000);
    await app.waitLog(/Cykl #3 zakończony/, 40000);
    assert.equal(overUrls.length, 3, `każde wyszukiwanie raz na noc: ${overUrls.join(" | ")}`);
    assert.equal(new Set(overUrls).size, 3, "trzy różne adresy");
    assert.ok(overUrls.some(u => u.includes("/anzeige:angebote/preis:1401:2100/dirt/k0c217")), "wyszukiwanie-kategoria z przedziałem powyżej limitu");
    assert.ok(overUrls.some(u => /preis:1401:2100\/Canyon(%20| )Torque\//.test(u)), "wyszukiwanie modelu z przedziałem powyżej limitu");
    assert.ok(!app.st.detailCalls.includes(X.id), "znane „za drogie” widziane na liście — bez strony ogłoszenia");
    assert.ok(app.st.detailCalls.includes("2000006176"), "„za drogie” spoza listy — strona ogłoszenia");
    assert.equal(genReqs(app.st).length, 0, `bez analizy AI: ${genReqs(app.st).map(b => (promptOf(b).match(/Tytuł[^\n]*/) || [promptOf(b).slice(0, 300)])[0]).join(" | ")}`);
    let s2 = [];
    for (let i = 0; i < 40; i++) { s2 = JSON.parse(await app.ls("ddf_seen") || "[]"); if (s2.some(e => e.id === N.id) && s2.some(e => e.id === D.id)) break; await app.page.waitForTimeout(250); }
    const by = (id) => s2.find(e => e.id === id);
    assert.equal(by(N.id)?.overMax, true, "nowe „za drogie” w pamięci");
    assert.equal(by(N.id)?.price, 1700);
    assert.equal(by(D.id)?.overMax, true, "nowe „za drogie” z wyszukiwania-kategorii");
    assert.equal(by(X.id)?.price, 1550, "znane „za drogie”: cena z karty");
    assert.equal(by(X.id)?.lowest, 1550);
    assert.ok(!by(P.id), "oferta spoza przedziału cen nie trafia do pamięci (zwykłe wyszukiwanie oceni ją normalnie)");
    assert.ok(!by(F.id), "powyżej górnej granicy — pomijane");
    assert.equal(JSON.parse(await app.ls("ddf_pending") || "[]").length, 0, "kolejka pusta");
  } finally { await close(app); }
});

await test("Noc: zapamiętane „za drogie” po obniżce do zakresu zakupu trafia do analizy (strona ogłoszenia w kolejną noc)", async () => {
  const old = Date.now() - 20 * 3600e3;
  const seen = [{ id: "2000006177", price: 1700, lowest: 1700, overMax: true, lastSeenAt: old }]; // zapamiętane poprzedniej nocy przez szukanie „za drogich”
  const search = (k, n, st, url) => /preis:1401:2100\//.test(url) ? [] : (k === "torque" ? [A] : []);
  const app = await openApp({ cfg: { nightCheckHour: new Date().getHours() }, ls: { ddf_seen: seen },
    world: { search, detail: (id) => id === "2000006177" ? { desc: GOOD, price: 1300, title: "Canyon Torque CF 9 neu teuer" } : { desc: GOOD }, ai: aiBy(NO) } });
  try {
    await app.start();
    await app.waitLog(/Nocne sprawdzanie: Canyon Torque CF 9 neu teuer — 1700€ → 1300€ \(zeszła do zakresu zakupu\) — do analizy/, 20000);
    await app.waitUntil(() => titledReq(app.st, "Canyon Torque CF 9 neu teuer"), 20000, "analiza po obniżce");
  } finally { await close(app); }
});

await test("Noc: 403 na wyszukiwaniu „za drogich” dwa razy pod rząd → przerwa we wszystkich zapytaniach, bez kolejnych prób", async () => {
  let over = 0;
  const search = (k, n, st, url) => { if (/preis:1401:2100\//.test(url)) { over++; return { status: 403 }; } return k === "torque" ? [A] : []; };
  const app = await openApp({ cfg: { nightCheckHour: new Date().getHours() }, world: { search, detail: () => ({ desc: GOOD }), ai: aiBy(NO) } });
  try {
    await app.start();
    await app.waitLog(/Nocne szukanie „za drogich”: Kleinanzeigen blokuje wyszukiwania \(2 pod rząd\) — przerwa 20 min/, 30000);
    await app.waitLog(/Nocne sprawdzanie cen czeka — przerwa po blokadzie/, 30000);
    assert.equal(over, 2, "dwie próby, potem przerwa");
    assert.equal(await app.countLogs(/Nieoczekiwany błąd w cyklu/), 0);
  } finally { await close(app); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
