import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v5.14: poprawki z audytu 12.11.2026 (Groq a kompletny rower, dirty rozpoznane przez AI, widelec bez modelu, rocznik dirta,
// „opłaca się do”, jedna próba na cykl, wznowienie weryfikacji, zmiana treści zaległej okazji, brak ceny na stronie,
// duplikaty, tekst awaryjny Discorda, trwałe wyniki, koszt każdego zapytania)
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const GUIDE = "WIDELEC W DIRCIE — JAK ROZPOZNAĆ";
const KB_DIRT = "BAZA CEN — Dirtówki";
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const HREF = (id) => `https://www.kleinanzeigen.de/s-anzeige/x/${id}-217-1234`;
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 300)}`); } }
const ai = (o = {}) => (b) => b.action ? {} : geminiResp(analysisJson(o), { imagesAttached: b.imageUrls?.length || 0 });
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const field = (e, s) => e.fields.find(x => x.name.includes(s))?.value;
const DIRT = { typ_roweru: "dirt", cena_zakupu_eur: 600, szacowana_sprzedaz_eur: 1100 };

// phases: tablica funkcji (k) => karty dla fazy 2, 3, …; faza 1 = sama oferta A (zapamiętanie)
async function run(opts, after) {
  let phase = 1;
  const pick = (k, url) => phase === 1 ? (k === "torque" ? [A] : []) : (opts.phases[Math.min(phase - 2, opts.phases.length - 1)](k, url) || []);
  const app = await openApp({ cfg: opts.cfg, ls: opts.ls, world: { detail: () => ({ desc: GOOD, images: 8 }), ...opts.world, search: (k, n, st, url) => pick(k, url) } });
  const next = () => { phase++; };
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app, next); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
}

await test("Groq „inny” (uznał za ramę) przy tytule bez słowa o części i cenie jak za rower → analiza AI; tania → odrzucona", async () => {
  const L1 = { id: "2000000401", title: "YT capra Industrie", price: 1250 };
  const L2 = { id: "2000000402", title: "YT Tues Industrie", price: 350 };
  const groq = () => ({ choices: [{ message: { content: "opis dotyczy wyłącznie ramy i komponentów, nie całego roweru.\ninny" }, finish_reason: "stop" }] });
  await run({ cfg: { selectedBikes: ["yt"], groqClassifierKey: "gsk_x" }, phases: [(k) => k === "other" ? [L1, L2] : []],
    world: { groq, ai: ai({ decyzja: "nie", szacowana_sprzedaz_eur: 1300 }) } }, async (app) => {
    await app.waitLog(/uznał za część.*YT capra Industrie|tytuł to znany model .*YT capra Industrie/); // v6.4: Capra to znany model YT
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes(L1.title)), 15000, "analiza AI L1");
    await app.waitLog(/Cykl #2 zakończony/);
    assert.ok(!genReqs(app.st).some(b => promptOf(b).includes(L2.title)), "tania oferta nie powinna iść do AI");
    assert.ok(app.st.groqReqs[0].messages[0].content.includes("ROZMIAR RAMY"), "prompt Groqa: Rahmen L = rozmiar");
  });
});

await test("Dirt rozpoznany dopiero przez AI → powtórka z wpisem bazy o dirtach, ściągą i wszystkimi zdjęciami; koszt w logu", async () => {
  const B = { id: "2000000402", title: "Dartmoor Hornet Custom Aufbau 26 Zoll", price: 600 };
  await run({ cfg: { selectedBikes: ["dartmoor"] }, phases: [(k, url) => k === "other" && /dartmoor/i.test(url || "") ? [B] : []], // v6.3: tylko wyszukiwanie marki (kolejność wyszukiwań się zmienia)
    world: { ai: ai({ ...DIRT, decyzja: "nie", szacowana_sprzedaz_eur: 700 }) } }, async (app) => {
    await app.waitUntil(() => genReqs(app.st).length >= 2, 15000, "2 analizy");
    const [r1, r2] = genReqs(app.st);
    assert.ok(!promptOf(r1).includes(GUIDE) && !promptOf(r1).includes(KB_DIRT), "pierwsza bez dirtowej bazy");
    assert.equal(r1.imageUrls.length, 4);
    assert.ok(promptOf(r2).includes(GUIDE), "powtórka ze ściągą");
    assert.ok(promptOf(r2).includes(KB_DIRT), "powtórka z wpisem bazy o dirtach");
    assert.ok(promptOf(r2).includes("BAZA CEN — Dartmoor"), "wpis marki zostaje");
    assert.equal(r2.imageUrls.length, 8);
    await app.waitLog(/powtarzam analizę z wpisem bazy o dirtach/);
    await app.waitLog(/💲 gemini-2\.5-flash \[analiza \(dirt\)\]: wejście 9000 tok/);
    await app.waitLog(/Cykl #2 zakończony/);
    const sp = JSON.parse(await app.ls("ddf_ai_spend"));
    assert.ok(sp.byStage.analiza.calls >= 1 && sp.byStage["analiza (dirt)"].calls === 1, "koszt wg etapów");
    assert.ok(await app.countLogs(/🔍 Sprawdzono \d+ wyszukiwań/) >= 2, "podsumowanie wyszukiwań zamiast linii na każde");
    assert.equal(await app.countLogs(/: brak nowych$/), 0, "bez rutynowych linii");
    await app.waitUntil(async () => ((await app.ls("ddf_results")) || "").includes(B.title), 5000, "wyniki zapisane w localStorage");
  });
});

await test("Widelec „marka bez modelu”: RockShox → ostrzeżenie; X-Fusion → bez ostrzeżenia", async () => {
  const B = { id: "2000000403", title: "Rose The Bruce 1 Dirt", price: 600 };
  await run({ phases: [(k) => k === "torque" ? [B] : []],
    world: { ai: ai({ ...DIRT, widelec: { model: "RockShox (model nieznany)", zrodlo: "napis", sztywny: false } }) } }, async (app) => {
    await app.waitUntil(() => deals(app.st).length, 20000, "okazja");
    const e = deals(app.st)[0].payload.embeds[0];
    assert.ok(field(e, "Widelec").includes("model nierozpoznany"), field(e, "Widelec"));
    assert.ok((field(e, "Do sprawdzenia") || "").includes("RockShox bez rozpoznanego modelu"), field(e, "Do sprawdzenia"));
  });
  const C = { id: "2000000404", title: "Rose The Bruce 2 Dirt", price: 600 };
  await run({ phases: [(k) => k === "torque" ? [C] : []],
    world: { ai: ai({ ...DIRT, widelec: { model: "X-Fusion (wersja nieczytelna)", zrodlo: "napis", sztywny: false } }) } }, async (app) => {
    await app.waitUntil(() => deals(app.st).length, 20000, "okazja");
    const e = deals(app.st)[0].payload.embeds[0];
    assert.ok(!(field(e, "Do sprawdzenia") || "").includes("sprawdź widelec"), "X-Fusion to zawsze słabsze pasmo — bez ostrzeżenia");
  });
});

await test("Rocznik dirta: oszacowany 2013 → nie odrzuca; podany 2013 → odrzuca", async () => {
  const est = { rocznik: 2013, rocznik_zrodlo: "oszacowany", rocznik_zakres: "2010-2016", e_bike: false, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true };
  const B = { id: "2000000405", title: "Rose The Bruce 3 Dirt", price: 600 };
  await run({ phases: [(k) => k === "torque" ? [B] : []], world: { ai: ai({ ...DIRT, fakty: est }) } }, async (app) => {
    await app.waitUntil(() => deals(app.st).length, 20000, "okazja mimo oszacowanego rocznika");
    assert.ok(promptOf(genReqs(app.st)[0]).includes("WYJĄTEK — dirt: tylko rocznik PODANY"), "reguła w prompcie");
  });
  const C = { id: "2000000406", title: "Rose The Bruce 4 Dirt", price: 600 };
  await run({ phases: [(k) => k === "torque" ? [C] : []], world: { ai: ai({ ...DIRT, fakty: { ...est, rocznik_zrodlo: "podany", rocznik_zakres: null } }) } }, async (app) => {
    await app.waitLog(/NIE opłaca się \(rocznik 2013/);
    assert.equal(deals(app.st).length, 0);
  });
});

await test("Dirt na granicy, oceniony już ze wszystkimi zdjęciami → bez drugiej analizy", async () => {
  const B = { id: "2000000407", title: "Rose The Bruce 5 Dirt", price: 600 };
  await run({ cfg: { minProfit: 35 }, phases: [(k) => k === "torque" ? [B] : []], world: { ai: ai({ ...DIRT, decyzja: "nie", szacowana_sprzedaz_eur: 850 }) } }, async (app) => {
    await app.waitLog(/dirt był już oceniony ze wszystkimi zdjęciami — bez drugiej analizy/);
    await app.waitLog(/Cykl #2 zakończony/);
    assert.equal(genReqs(app.st).length, 1);
  });
});

await test("Cena spadła do „opłaca się do” (spadek < 20%) → ponowna analiza", async () => {
  const B = (p) => ({ id: "2000000408", title: "Canyon Torque AL 6", price: p });
  await run({ cfg: { minProfit: 35 }, phases: [(k) => k === "torque" ? [A, B(700)] : [], (k) => k === "torque" ? [A, B(610)] : []],
    world: { ai: ai({ decyzja: "nie", cena_zakupu_eur: 700, szacowana_sprzedaz_eur: 900 }) } }, async (app, next) => {
    await app.waitLog(/Cykl #2 zakończony/);
    await app.waitQueueEmpty(); // v6.3: analiza w tle
    assert.equal(genReqs(app.st).filter(b => !isVer(b)).length, 1);
    const seen = JSON.parse(await app.ls("ddf_seen")).find(e => e.id === "2000000408");
    // v6.1: zamiast jednej kwoty „opłaca się do” zapamiętana wycena (sprzedaż + transport) — próg liczony dla nowej ceny
    assert.equal(seen.watchSale, 900, "zapamiętana szacowana sprzedaż");
    assert.equal(seen.watchT, 70, "zapamiętany transport");
    next();
    await app.waitLog(/według wcześniejszej wyceny zakup spełnia próg zysku: Canyon Torque AL 6 → 610€/, 20000);
    await app.waitUntil(() => genReqs(app.st).filter(b => !isVer(b)).length >= 2, 15000, "druga analiza");
  });
});

await test("Awaria AI: przerwa po 2 nieudanych pod rząd; 3. nieudana próba → niepewne", async () => {
  const job = (id, attempts) => ({ listing: { listingId: id, title: `Canyon Torque Test ${id}`, price: 900, href: HREF(id), desc: "", bike: "Canyon Torque" },
    source: "new", stage: "analyze", groqType: "full", attempts, addedAt: Date.now(), nextAttemptAt: 0 });
  const app = await openApp({ ls: { ddf_pending: [job("2000000409", 2), job("2000000410", 0)] }, world: {
    search: () => [A], detail: () => ({ desc: GOOD, images: 2, price: 900 }),
    ai: (b) => b.action ? {} : { __status: 500, __json: { error: { message: "Internal error" } } } } });
  try {
    await app.start();
    await app.waitLog(/nie powiodła się 3× — przenoszę do niepewnych: Canyon Torque Test 2000000409/);
    await app.waitLog(/2 analizy pod rząd nieudane — przerwa w analizach AI/);
    await app.waitLog(/Cykl #2 zakończony/, 20000);
    assert.equal(genReqs(app.st).length, 2, "w czasie przerwy bez kolejnych zapytań");
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

await test("Weryfikacja przerwana krytycznym błędem → następny cykl wznawia od weryfikacji (bez drugiej pierwszej analizy)", async () => {
  const B = { id: "2000000411", title: "Canyon Torque AL 7", price: 900 };
  let verN = 0;
  await run({ phases: [(k) => k === "torque" ? [A, B] : []], world: { ai: (b) => {
    if (b.action) return {};
    if (isVer(b) && ++verN === 1) return { __status: 200, __json: { error: { message: "PERMISSION_DENIED: brak dostępu do modelu" } } };
    return geminiResp(analysisJson(), { imagesAttached: b.imageUrls?.length || 0 });
  } } }, async (app) => {
    await app.waitLog(/Wznawiam od weryfikacji/, 25000);
    await app.waitUntil(() => deals(app.st).length, 20000, "okazja po wznowieniu");
    assert.equal(genReqs(app.st).filter(b => !isVer(b)).length, 1, "pierwsza analiza tylko raz");
    assert.equal(genReqs(app.st).filter(isVer).length, 2);
  });
});

await test("Zaległa okazja: opis zmienił się od analizy → nie wysyłana, analiza od nowa", async () => {
  const id = "2000000412";
  const item = { id: "o1", kind: "deal", addedAt: Date.now() - 2 * 3600e3, tries: 0, contentKey: "stary-odcisk",
    listing: { listingId: id, title: "Canyon Torque Zaległy", price: 800, href: HREF(id), desc: "", bike: "Canyon Torque" },
    analysis: { typ_roweru: "full", decyzja: "tak", przewidywany_zysk: 430, szacowana_sprzedaz_eur: 1300, cena_zakupu_eur: 800, transport_eur: 70, krotki_opis: "x", fakty: { rocznik: 2020, rocznik_zrodlo: "podany" } } };
  const app = await openApp({ ls: { ddf_outbox: [item] }, world: { search: () => [A],
    detail: () => ({ desc: "ACHTUNG: Rahmen gerissen, nur als Ersatzteilspender!", images: 2, price: 800 }),
    ai: ai({ decyzja: "nie", szacowana_sprzedaz_eur: 300, cena_zakupu_eur: 800 }) } });
  try {
    await app.start();
    await app.waitLog(/opis lub zdjęcia zmieniły się od analizy — nie wysyłam, analizuję ponownie: Canyon Torque Zaległy/);
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes("Rahmen gerissen")), 15000, "ponowna analiza z nowym opisem");
    await app.waitLog(/Cykl #1 zakończony/);
    assert.equal(deals(app.st).length, 0, "stara okazja nie poszła");
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

await test("Strona ogłoszenia bez ceny: najpierw czeka, potem analiza, okazja → niepewne", async () => {
  const B = { id: "2000000413", title: "Canyon Torque AL 8", price: 900 };
  await run({ phases: [(k) => k === "torque" ? [A, B] : []], world: { detail: () => ({ desc: GOOD, images: 2, price: null }), ai: ai() } }, async (app) => {
    await app.waitLog(/Strona ogłoszenia bez odczytanej ceny .* sprawdzę ponownie w następnym cyklu/);
    await app.waitLog(/Strona ogłoszenia znowu bez ceny/, 25000);
    await app.waitUntil(() => app.st.discord.some(d => d.webhookUrl.includes("/2/") && d.payload.content.includes("niepotwierdzona")), 20000, "niepewne z niepotwierdzoną ceną");
    assert.equal(deals(app.st).length, 0);
  });
});

await test("Discord odrzuca embed → tekst awaryjny z weryfikacją, widelcem i ostrzeżeniami", async () => {
  const B = { id: "2000000414", title: "Rose The Bruce 6 Dirt", price: 600 };
  await run({ phases: [(k) => k === "torque" ? [B] : []], world: {
    ai: ai({ ...DIRT, ostrzezenia: "rysa na ramie do sprawdzenia", widelec: { model: "RockShox Pike DJ", zrodlo: "napis", sztywny: false } }),
    discord: (body) => body.payload.embeds ? { ok: false, status: 400, retryAfter: null, error: "Invalid Form Body" } : { ok: true, status: 204, retryAfter: null, error: null } } }, async (app) => {
    await app.waitUntil(() => app.st.discord.some(d => !d.payload.embeds && /OKAZJA/.test(d.payload.content || "")), 20000, "tekst awaryjny");
    const t = app.st.discord.find(d => !d.payload.embeds && /OKAZJA/.test(d.payload.content || "")).payload.content;
    assert.ok(t.includes("🕵️ Weryfikacja:"), t);
    assert.ok(t.includes("🔧 Widelec: RockShox Pike DJ"), t);
    assert.ok(t.includes("rysa na ramie"), t);
  });
});

await test("Ten sam rower pod dwoma numerami (tytuł + cena + te same zdjęcia) → jeden alert, jedna analiza", async () => {
  const B1 = { id: "2000000415", title: "Canyon Torque CF 9", price: 900 };
  const B2 = { id: "2000000416", title: "Canyon Torque CF 9", price: 900 };
  await run({ phases: [(k) => k === "torque" ? [A, B1, B2] : []], world: { ai: ai() } }, async (app) => {
    await app.waitLog(/Duplikat ogłoszenia 200000041[56] \(identyczne zdjęcia/, 25000); // v6.2: te same adresy zdjęć = to samo ogłoszenie
    await app.waitLog(/Cykl #2 zakończony/);
    assert.equal(deals(app.st).length, 1);
    assert.equal(genReqs(app.st).filter(b => !isVer(b)).length, 1, "v6.1: duplikat bez analizy AI");
  });
});

for (const r of results) console.log(r);
await closeBrowser();
if (results.some(r => r.startsWith("❌"))) process.exit(1);
