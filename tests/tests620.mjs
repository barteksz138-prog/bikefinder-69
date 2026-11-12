import { openApp, closeBrowser, analysisJson, geminiResp, hashStr, normTitle } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.2: poprawki z audytu v6.1 — B1 (opis nie scala różnych sprzedawców), B2 (nowy numer przejmuje obserwację ceny),
// B3 („okazja już zgłoszona” tylko po wysyłce; link w oczekującym alercie; utracony alert → analiza), B4 (tytuł ze strony
// ogłoszenia), jedna aktywna karta skanera (Web Locks)
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const warnOf = (d) => d.payload.embeds[0].fields.find(f => f.name.includes("Do sprawdzenia"))?.value || "";
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const TEMPLATE = "Guter Zustand, nur Abholung, keine Garantie, keine Rücknahme. Privatverkauf. Bei Interesse einfach melden.";
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const HREF = (id) => `https://www.kleinanzeigen.de/s-anzeige/x/${id}-217-1234`;
const TIERS = [60, 40, 30, 20];
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 300)}`); } }
const ai = (o = {}) => (b) => b.action ? {} : geminiResp(analysisJson(o), { imagesAttached: b.imageUrls?.length || 0 });
const dk = (desc) => hashStr(desc.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ""));

async function run(opts, after) {
  let phase = 1;
  const pick = (k) => phase === 1 ? (k === "torque" ? [A] : []) : (opts.phases[Math.min(phase - 2, opts.phases.length - 1)](k) || []);
  const app = await openApp({ cfg: opts.cfg, ls: opts.ls, world: { detail: () => ({ desc: GOOD, images: 4 }), ...opts.world, search: (k) => pick(k) } });
  const next = () => { phase++; };
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app, next); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
}

await test("B1: różni sprzedawcy, ten sam szablonowy opis, tytuł i cena → dwa rowery, dwa alerty", async () => {
  const B1 = { id: "2000000621", title: "Canyon Torque CF 8 B1", price: 900 };
  const B2 = { id: "2000000622", title: "Canyon Torque CF 8 B1", price: 900 };
  const detail = (id) => ({ desc: TEMPLATE, images: 4, imgSet: id === B1.id ? "b1" : "b2", seller: id === B1.id ? "111" : "222" });
  await run({ phases: [(k) => k === "torque" ? [A, B1, B2] : []], world: { detail, ai: ai() } }, async (app) => {
    await app.waitUntil(() => deals(app.st).length >= 2, 30000, "dwa alerty");
    assert.equal(await app.countLogs(/Duplikat ogłoszenia/), 0);
    assert.ok(deals(app.st).every(d => !warnOf(d).includes("duplikat")), "bez ostrzeżenia — sprzedawcy różni");
  });
});

await test("Ten sam sprzedawca, inny opis i zdjęcia → oba analizowane, drugi alert z ostrzeżeniem „możliwy duplikat”", async () => {
  const B1 = { id: "2000000623", title: "Canyon Torque CF 8 Two", price: 900 };
  const B2 = { id: "2000000624", title: "Canyon Torque CF 8 Two", price: 900 };
  const detail = (id) => ({ desc: id === B1.id ? GOOD : GOOD + " Zweites Exemplar, Größe M.", images: 4, imgSet: id === B1.id ? "c1" : "c2", seller: "333" });
  await run({ phases: [(k) => k === "torque" ? [A, B1, B2] : []], world: { detail, ai: ai() } }, async (app) => {
    await app.waitUntil(() => deals(app.st).length >= 2, 30000, "dwa alerty");
    assert.equal(deals(app.st).filter(d => /możliwy duplikat ogłoszenia 200000062[34] \(ten sam sprzedawca, inny opis i zdjęcia\)/.test(warnOf(d))).length, 1);
  });
});

await test("Identyczny opis, sprzedawca nieznany, inne zdjęcia → analiza z ostrzeżeniem, nie pomijanie", async () => {
  const B1 = { id: "2000000625", title: "Canyon Torque CF 8 Anon", price: 900 };
  const B2 = { id: "2000000626", title: "Canyon Torque CF 8 Anon", price: 900 };
  const detail = (id) => ({ desc: TEMPLATE, images: 4, imgSet: id === B1.id ? "d1" : "d2" });
  await run({ phases: [(k) => k === "torque" ? [A, B1, B2] : []], world: { detail, ai: ai() } }, async (app) => {
    await app.waitUntil(() => deals(app.st).length >= 2, 30000, "dwa alerty");
    assert.ok(deals(app.st).some(d => /identyczny opis, sprzedawca nieznany/.test(warnOf(d))));
  });
});

await test("B2: nowy numer tego samego roweru przejmuje obserwację ceny — spadek 445 → 437 € wraca do analizy", async () => {
  const L1 = { id: "2000000627", title: "Canyon Torque AL Relist", price: 445 };
  const L2 = (p) => ({ id: "2000000628", title: "Canyon Torque AL Relist", price: p });
  const detail = (id) => ({ desc: GOOD, images: 4, imgSet: id === L1.id ? "e1" : "e2", seller: "444" });
  await run({ cfg: { profitTiers: TIERS }, phases: [(k) => k === "torque" ? [A, L1] : [], (k) => k === "torque" ? [A, L2(445)] : [], (k) => k === "torque" ? [A, L2(437)] : []],
    world: { detail, ai: ai({ decyzja: "nie", cena_zakupu_eur: 445, szacowana_sprzedaz_eur: 770 }) } }, async (app, next) => {
    await app.waitLog(/Cykl #2 zakończony/); await app.waitQueueEmpty(); // v6.3: analiza w tle
    next();
    await app.waitLog(/Duplikat ogłoszenia 2000000627 \(ten sam sprzedawca i opis/, 20000);
    await app.waitLog(/Cykl #3 zakończony/); await app.waitQueueEmpty();
    const seen = JSON.parse(await app.ls("ddf_seen")).find(e => e.id === "2000000628");
    assert.equal(seen.watchSale, 770, "nowy numer ma wycenę do obserwacji");
    const before = genReqs(app.st).length;
    next();
    await app.waitLog(/według wcześniejszej wyceny zakup spełnia próg zysku: Canyon Torque AL Relist → 437€/, 20000);
    await app.waitUntil(() => genReqs(app.st).length > before, 15000, "ponowna analiza nowego numeru");
  });
});

await test("B3: okazja czeka (Discord nie działa) → nowy numer podmienia link w oczekującym alercie, bez drugiej analizy", async () => {
  const L1 = { id: "2000000629", title: "Canyon Torque CF Pending", price: 900 };
  const L2 = { id: "2000000630", title: "Canyon Torque CF Pending", price: 900 };
  let discordUp = false;
  const discord = (body) => (discordUp || !body.payload?.embeds || !/OKAZJA/.test(body.payload.embeds[0].title)) ? { ok: true, status: 204 } : { ok: false, status: 500, error: "down" };
  const detail = (id) => ({ desc: GOOD, images: 4, imgSet: id === L1.id ? "f1" : "f2", seller: "555" });
  await run({ phases: [(k) => k === "torque" ? [A, L1] : [], (k) => k === "torque" ? [A, L2] : []], world: { detail, discord, ai: ai() } }, async (app, next) => {
    await app.waitLog(/okazja NIE wysłana/, 20000);
    const nAi = genReqs(app.st).length;
    next();
    await app.waitLog(/Oczekujący alert: link .*2000000629.* → .*2000000630/, 20000);
    assert.ok((await app.logs()).some(l => /Duplikat ogłoszenia 2000000629 .*okazja czeka na wysłanie/.test(l)));
    discordUp = true;
    await app.waitUntil(() => app.st.discord.some(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title) && JSON.stringify(d.payload).includes("2000000630")), 30000, "alert z nowym linkiem");
    assert.equal(genReqs(app.st).length, nAi, "bez analizy nowego numeru");
    await app.waitLog(/Wysłano na Discord: Canyon Torque CF Pending — .*2000000630/, 10000);
    const dupes = JSON.parse(await app.ls("ddf_dupes"));
    assert.equal(dupes["2000000629"].alert, "sent");
    assert.deepEqual(dupes["2000000629"].ids, ["2000000630"]);
  });
});

const seedDeal = (alert) => ({ ddf_dupes: { "2000000631": { tp: `${normTitle("Canyon Torque CF Relisted")}|900`, seller: "666", dk: dk(GOOD), ik: null,
  t: Date.now(), kind: "deal", typ: "full", dec: "tak", opis: "Zakup 900€ → …", ids: [], href: HREF("2000000631"), watchSale: null, watchT: null, alert } } });

await test("B3: alert utracony (stare ogłoszenie usunięte przed wysyłką) → nowy numer analizowany i wysłany", async () => {
  const L2 = { id: "2000000632", title: "Canyon Torque CF Relisted", price: 900 };
  await run({ ls: seedDeal("lost"), phases: [(k) => k === "torque" ? [A, L2] : []],
    world: { detail: () => ({ desc: GOOD, images: 4, imgSet: "g2", seller: "666" }), ai: ai() } }, async (app) => {
    await app.waitLog(/Ponowne wystawienie ogłoszenia 2000000631 .*wcześniejszy alert nie dotarł, analizuję nowy numer/, 20000);
    await app.waitUntil(() => deals(app.st).length >= 1, 30000, "alert nowego numeru");
  });
});

await test("Alert potwierdzony (wysłany) → nowy numer pomijany jako „okazja już zgłoszona”", async () => {
  const L2 = { id: "2000000633", title: "Canyon Torque CF Relisted", price: 900 };
  await run({ ls: seedDeal("sent"), phases: [(k) => k === "torque" ? [A, L2] : []],
    world: { detail: () => ({ desc: GOOD, images: 4, imgSet: "h2", seller: "666" }), ai: ai() } }, async (app) => {
    await app.waitLog(/Duplikat ogłoszenia 2000000631 .*okazja już zgłoszona/, 20000);
    await app.waitLog(/Cykl #2 zakończony/);
    assert.equal(deals(app.st).length, 0);
    assert.equal(genReqs(app.st).length, 0);
  });
});

await test("B4: strona ogłoszenia ma inny tytuł niż karta → ocena od początku z tytułem ze strony, bez przeskakiwania", async () => {
  const id = "2000000634";
  const card = { id, title: "Canyon Torque AL 2020 Karte", price: 900 };
  await run({ phases: [(k) => k === "torque" ? [A, card] : []],
    world: { detail: () => ({ desc: GOOD, images: 4, title: "Canyon Torque AL Seite 2019" }), ai: ai({ decyzja: "nie", szacowana_sprzedaz_eur: 900 }) } }, async (app) => {
    await app.waitLog(/Strona ogłoszenia ma inny tytuł niż lista: „Canyon Torque AL 2020 Karte” → „Canyon Torque AL Seite 2019”/, 20000);
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes("Canyon Torque AL Seite 2019")), 20000, "analiza z tytułem ze strony");
    await app.waitLog(/Cykl #3 zakończony/, 20000);
    assert.ok(!genReqs(app.st).some(b => promptOf(b).includes("Canyon Torque AL 2020 Karte")), "AI nie dostało tytułu z karty");
    assert.equal(await app.countLogs(/Kolejka: zmiana tytułu/), 0, "karta z tym samym tytułem nie cofa zmiany");
    assert.equal(await app.countLogs(/Strona ogłoszenia ma inny tytuł/), 1);
  });
});

await test("Jedna karta skanera: druga karta nie startuje (ani ręcznie, ani z autostartu), po STOP pierwszej — może", async () => {
  const world = { search: () => [A], detail: () => ({ desc: GOOD }), ai: ai() };
  const a = await openApp({ world });
  let b = null;
  try {
    await a.start();
    await a.waitLog(/Uruchamiam skanowanie/);
    b = await openApp({ world, keepContext: a.ctx });
    await b.waitLog(/Skaner już działa w innej karcie tej przeglądarki/, 12000); // autostart po 5 s
    await b.waitUntil(() => b.page.evaluate(() => !!document.querySelector("[data-testid=other-tab]")), 8000, "baner drugiej karty");
    await b.start();
    await b.waitUntil(async () => (await b.countLogs(/Skaner już działa w innej karcie/)) >= 2, 5000, "drugi odmowny start");
    assert.equal(await b.countLogs(/Uruchamiam skanowanie/), 0);
    await a.stop(); await a.waitStopped();
    await b.start();
    await b.waitLog(/Uruchamiam skanowanie/, 10000);
    await b.stop(); await b.waitStopped();
  } finally {
    if (b) await b.page.close().catch(() => {});
    await a.stop().catch(() => {}); await a.close();
  }
});

for (const r of results) console.log(r);
await closeBrowser();
if (results.some(r => r.startsWith("❌"))) process.exit(1);
