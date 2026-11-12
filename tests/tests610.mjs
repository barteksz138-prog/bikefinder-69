import { openApp, closeBrowser, analysisJson, geminiResp, contentKeyOf } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.1: poprawki z audytu v6.0 — wspólna reguła zysku (opłaca się do / propozycja / obserwacja spadku), duplikaty po sprzedawcy
// albo opisie, zmiana tytułu w kolejce, przeliczony opis zaległej okazji, zaległe okazje bez odcisku treści, linia stanu skanera
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const HREF = (id) => `https://www.kleinanzeigen.de/s-anzeige/x/${id}-217-1234`;
const TIERS = [60, 40, 30, 20];
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 300)}`); } }
const ai = (o = {}) => (b) => b.action ? {} : geminiResp(analysisJson(o), { imagesAttached: b.imageUrls?.length || 0 });

// phases: tablica funkcji (k) => karty dla fazy 2, 3, …; faza 1 = sama oferta A (zapamiętanie)
async function run(opts, after) {
  let phase = 1;
  const pick = (k) => phase === 1 ? (k === "torque" ? [A] : []) : (opts.phases[Math.min(phase - 2, opts.phases.length - 1)](k) || []);
  const app = await openApp({ cfg: opts.cfg, ls: opts.ls, world: { detail: () => ({ desc: GOOD, images: 4 }), ...opts.world, search: (k) => pick(k) } });
  const next = () => { phase++; };
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app, next); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
}

await test("Audyt: progi 60/40/30/20, sprzedaż 770 €, cena 600 € → opłaca się do 500 €, propozycja 430 € (nie 440 €)", async () => {
  // 500 € (próg 40%): zysk 200 € = 40% ✓. Propozycja 0,88 × 500 = 440 € to już przedział 200–450 (próg 60%): zysk 260 € = 59% ✗
  // → najwyższa cena ≤ 440 spełniająca próg = 437 €, w dół do 10 € = 430 €
  const B = { id: "2000000611", title: "Canyon Torque AL 600", price: 600 };
  await run({ cfg: { profitTiers: TIERS, nearWebhook: "https://discord.com/api/webhooks/3/near" }, phases: [(k) => k === "torque" ? [A, B] : []],
    world: { ai: ai({ decyzja: "nie", cena_zakupu_eur: 600, szacowana_sprzedaz_eur: 770 }) } }, async (app) => {
    await app.waitLog(/Na granicy okazji: Canyon Torque AL 600 — 600€, opłaca się do 500€, proponuj 430€/, 20000);
    const near = app.st.discord.find(d => d.webhookUrl.includes("/3/near"));
    assert.ok(near, "alert na granicy");
    assert.ok(near.payload.embeds[0].fields.find(f => f.name.includes("Proponuj")).value.startsWith("**430€** (zysk ~270€"));
  });
});

await test("Audyt: 445 € (zysk 57% < 60%) → spadek do 437 € (60,2%) wraca do analizy, choć spadek < 20%", async () => {
  const B = (p) => ({ id: "2000000612", title: "Canyon Torque AL 445", price: p });
  await run({ cfg: { profitTiers: TIERS }, phases: [(k) => k === "torque" ? [A, B(445)] : [], (k) => k === "torque" ? [A, B(437)] : []],
    world: { ai: ai({ decyzja: "nie", cena_zakupu_eur: 445, szacowana_sprzedaz_eur: 770 }) } }, async (app, next) => {
    await app.waitLog(/Cykl #2 zakończony/); await app.waitQueueEmpty(); // v6.3: analiza w tle
    const before = genReqs(app.st).length; // wynik graniczny może dostać dokładną analizę — liczymy od tego miejsca
    assert.ok(before >= 1);
    next();
    await app.waitLog(/według wcześniejszej wyceny zakup spełnia próg zysku: Canyon Torque AL 445 → 437€/, 20000);
    await app.waitUntil(() => genReqs(app.st).length > before, 15000, "ponowna analiza");
  });
});

await test("Stary wpis z kwotą „opłaca się do” (nearMax) nadal działa", async () => {
  const id = "2000000613";
  const B = (p) => ({ id, title: "Canyon Torque AL alt wpis", price: p });
  await run({ ls: { ddf_seen: [{ id, price: 700, lowest: 700, type: "full", nearMax: 650, lastSeenAt: Date.now() }] },
    phases: [(k) => k === "torque" ? [A, B(640)] : []], world: { ai: ai({ decyzja: "nie", cena_zakupu_eur: 640, szacowana_sprzedaz_eur: 800 }) } }, async (app) => {
    await app.waitLog(/Cena spadła do kwoty „opłaca się do” \(650€\): Canyon Torque AL alt wpis → 640€/, 20000);
  });
});

await test("Ten sam tytuł i cena, ale inny sprzedawca i inny opis → dwa różne rowery, dwa alerty", async () => {
  const B1 = { id: "2000000614", title: "Canyon Torque CF 8", price: 900 };
  const B2 = { id: "2000000615", title: "Canyon Torque CF 8", price: 900 };
  const detail = (id) => id === B1.id ? { desc: GOOD, images: 4, seller: "111" } : { desc: GOOD + " Zweiter Satz Reifen dabei, neue Kette.", images: 4, seller: "222" };
  await run({ phases: [(k) => k === "torque" ? [A, B1, B2] : []], world: { detail, ai: ai() } }, async (app) => {
    await app.waitUntil(() => deals(app.st).length >= 2, 30000, "dwa alerty");
    assert.equal(await app.countLogs(/Duplikat ogłoszenia/), 0);
  });
});

await test("Ten sam tytuł, cena, sprzedawca i opis (nowe zdjęcia) → duplikat: bez analizy AI i bez drugiego alertu", async () => {
  const B1 = { id: "2000000616", title: "Canyon Torque CF 9 Dup", price: 900 };
  const B2 = { id: "2000000617", title: "Canyon Torque CF 9 Dup", price: 900 };
  const detail = (id) => ({ desc: GOOD, images: 4, imgSet: id === B1.id ? "a1" : "a2", seller: "164360590" });
  await run({ phases: [(k) => k === "torque" ? [A, B1, B2] : []], world: { detail, ai: ai() } }, async (app) => {
    await app.waitLog(/Duplikat ogłoszenia 200000061[67] \(ten sam sprzedawca i opis, ten sam tytuł i cena\)/, 25000);
    await app.waitLog(/Cykl #2 zakończony/); await app.waitQueueEmpty();
    assert.equal(deals(app.st).length, 1);
    assert.equal(genReqs(app.st).filter(b => !isVer(b)).length, 1, "druga oferta bez analizy AI");
    const dupes = JSON.parse(await app.ls("ddf_dupes"));
    assert.equal(Object.values(dupes).filter(e => e.seller === "164360590").length, 1, "indeks ma pierwsze ogłoszenie");
  });
});

await test("Zmiana tytułu oferty czekającej w kolejce → ocena od początku z nowym tytułem", async () => {
  const id = "2000000618";
  // v6.3: analiza idzie w tle i cykle w testach są bardzo krótkie — strona ogłoszenia „nie działa”, dopóki
  // wyszukiwanie nie zobaczy nowego tytułu; inaczej oferta mogłaby zostać przeanalizowana, zanim tytuł się zmieni
  let titleSeen = false;
  const detail = () => (titleSeen ? { desc: GOOD, images: 4 } : { status: 500 });
  await run({ phases: [(k) => k === "torque" ? [A, { id, title: "Canyon Torque AL 7", price: 900 }] : [],
    (k) => k === "torque" ? [A, { id, title: "Canyon Torque AL 7 Rahmen defekt", price: 900 }] : []],
    world: { detail, ai: ai({ decyzja: "nie", szacowana_sprzedaz_eur: 900 }) } }, async (app, next) => {
    await app.waitLog(/chwilowo niedostępna/, 20000);
    next();
    await app.waitLog(/Kolejka: zmiana tytułu „Canyon Torque AL 7” → „Canyon Torque AL 7 Rahmen defekt” — oceniam od początku/, 20000);
    titleSeen = true;
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes("Rahmen defekt")), 20000, "analiza z nowym tytułem");
    assert.ok(!genReqs(app.st).some(b => promptOf(b).includes("Canyon Torque AL 7\n")), "bez analizy ze starym tytułem");
  });
});

const staleDeal = (extra = {}) => ({ id: "o1", kind: "deal", addedAt: Date.now() - 2 * 3600e3, tries: 0,
  listing: { listingId: "2000000619", title: "Canyon Torque AL 6 2021", price: 700, href: HREF("2000000619"), desc: "", bike: "Canyon Torque" },
  analysis: { typ_roweru: "full", decyzja: "tak", przewidywany_zysk: 630, transport_eur: 70, cena_zakupu_eur: 700, szacowana_sprzedaz_eur: 1400,
    krotki_opis: "Zakup 700€ → szacowana sprzedaż PL 1400€ → zysk ~630€ po transporcie (70€) · rocznik 2021 (podany). ⚠️ rysa", _summary: "Zakup 700€ → szacowana sprzedaż PL 1400€ → zysk ~630€ po transporcie (70€) · rocznik 2021 (podany).",
    fakty: { rocznik: 2021, rocznik_zrodlo: "podany" } }, ...extra });

await test("Zaległa okazja, cena 700 → 750 €: opis na Discordzie z nowymi liczbami (nie stare „Zakup 700€ … ~630€”)", async () => {
  const item = staleDeal({ contentKey: contentKeyOf({ title: "Canyon Torque AL 6 2021", desc: GOOD }) });
  const app = await openApp({ ls: { ddf_outbox: [item] }, world: { search: () => [A], detail: () => ({ desc: GOOD, price: 750 }), ai: () => ({}) } });
  try {
    await app.start();
    await app.waitUntil(() => deals(app.st).length, 15000, "okazja");
    const e = deals(app.st)[0].payload.embeds[0];
    const opis = e.fields.find(f => f.name.includes("Krótki opis")).value;
    assert.ok(opis.includes("700€ → 750€"), opis);
    assert.ok(opis.includes("Zakup 750€") && opis.includes("zysk ~580€"), opis);
    assert.ok(!opis.includes("Zakup 700€") && !opis.includes("~630€"), opis);
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

await test("Zaległa okazja bez odcisku treści (sprzed v5.14) → nie wysłana, analiza od nowa", async () => {
  const app = await openApp({ ls: { ddf_outbox: [staleDeal()] }, world: { search: () => [A], detail: () => ({ desc: GOOD, price: 700 }),
    ai: ai({ decyzja: "nie", cena_zakupu_eur: 700, szacowana_sprzedaz_eur: 800 }) } });
  try {
    await app.start();
    await app.waitLog(/Zaległa okazja z poprzedniej wersji \(bez zapisu treści\).*analizuję ponownie: Canyon Torque AL 6 2021/);
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes("Canyon Torque AL 6 2021")), 15000, "ponowna analiza");
    await app.waitLog(/Cykl #1 zakończony/);
    assert.equal(deals(app.st).length, 0);
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

await test("Linia stanu skanera: co robi teraz + ostatnia aktywność", async () => {
  const app = await openApp({ world: { search: () => [A], detail: () => ({ desc: GOOD }), ai: ai() } });
  try {
    await app.start();
    const seen = new Set();
    await app.waitUntil(async () => {
      const t = await app.page.evaluate(() => document.querySelector("[data-testid=scan-status]")?.parentElement?.innerText || "");
      if (/Wyszukiwanie \d+\/\d+: Canyon Torque/.test(t)) seen.add("search");
      if (/przerwa — następny cykl za \d+ s/.test(t)) seen.add("pause");
      if (/ostatnia aktywność \d+ s temu/.test(t)) seen.add("activity");
      return seen.has("activity") && (seen.has("search") || seen.has("pause"));
    }, 15000, "linia stanu");
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

for (const r of results) console.log(r);
await closeBrowser();
if (results.some(r => r.startsWith("❌"))) process.exit(1);
