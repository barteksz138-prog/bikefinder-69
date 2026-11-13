import { openApp, closeBrowser, analysisJson, geminiResp, groqResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.4: audyt v6.3 — B1 (ustawienia w wykonawcy AI), B3 (fałszywa captcha), B4 (druga karta), B7 (rocznik), B8 (pełna pamięć),
// U5 (linki), U2 (obecny układ kart i strony ogłoszenia), „niepewne” tuż nad progiem → weryfikacja, znane modele w wyszukiwaniu
// całej marki, katalog e-MTB w bazie, nocne sprawdzanie cen
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const ai = (o = {}) => (b) => b.action ? {} : geminiResp(analysisJson(o), { imagesAttached: b.imageUrls?.length || 0 });
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };

await test("B1: zmiana transportu w Ustawieniach po Starcie działa w analizie w tle (bez odświeżania)", async () => {
  let phase = 1;
  const B = { id: "2000000641", title: "Canyon Torque CF Transport", price: 900 };
  const app = await openApp({ cfg: { profitTiers: [35, 35, 35, 35], transportCostEur: 70 }, world: { detail: () => ({ desc: GOOD, images: 4 }),
    ai: ai({ cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1300, przewidywany_zysk: 330 }), search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/);
    await app.page.getByRole("button", { name: "⚙️ Ustawienia" }).click();
    const inp = app.page.locator('label:has-text("Koszt transportu jednego roweru") + input');
    await inp.fill("150");
    await app.page.waitForTimeout(800);
    phase = 2;
    await app.waitUntil(() => genReqs(app.st).length >= 1, 20000, "analiza");
    await app.waitQueueEmpty();
    assert.ok(promptOf(genReqs(app.st)[0]).includes("150€"), "prompt z nowym transportem");
    assert.equal(deals(app.st).length, 0, "1300 − 900 − 150 = 250 € = 27,8% < 35% → brak okazji");
  } finally { await close(app); }
});

await test("B3: „Saugroboter” w opisie karty to nie captcha — oferta zapamiętana, bez przerwy 20 min", async () => {
  const R = { id: "2000000642", title: "Canyon Torque Tausch", price: 900, desc: "Tausch gegen Mähroboter oder Saugroboter möglich" };
  const app = await openApp({ world: { search: (k) => k === "torque" ? [A, R] : [], detail: () => ({ desc: GOOD }) } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/);
    assert.equal(await app.countLogs(/captcha/), 0);
    const seen = JSON.parse(await app.ls("ddf_seen"));
    assert.ok(seen.some(e => e.id === R.id), "oferta w pamięci widzianych");
  } finally { await close(app); }
});

await test("B4: druga karta po przejęciu skanowania nie analizuje ani nie wysyła drugi raz tej samej okazji", async () => {
  let phase = 1;
  const B = { id: "2000000643", title: "Canyon Torque CF Takeover", price: 900 };
  const world = { detail: () => ({ desc: GOOD, images: 4 }), ai: ai(), search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] };
  const a = await openApp({ world });
  let b = null;
  try {
    b = await openApp({ world, keepContext: a.ctx }); // karta-podgląd otwarta WCZEŚNIEJ (stara pamięć w karcie)
    await a.start(); await a.waitLog(/Cykl #1 zakończony/); phase = 2;
    await a.waitUntil(() => deals(a.st).length >= 1, 20000, "okazja w karcie A");
    await a.waitQueueEmpty();
    await a.stop(); await a.waitStopped();
    await b.start();
    await b.waitLog(/Cykl #1 zakończony/, 20000);
    await b.page.waitForTimeout(500);
    assert.equal(genReqs(b.st).length, 0, "karta B nie analizuje ponownie");
    assert.equal(deals(b.st).length, 0, "karta B nie wysyła drugi raz");
  } finally { if (b) await close(b); await a.close(); }
});

await test("B7: „Baujahr 2016/2017” w opisie — liczy się 2017 (bez odrzucenia bez AI)", async () => {
  let phase = 1;
  const B = { id: "2000000644", title: "Canyon Torque AL Bj", price: 900 };
  const app = await openApp({ world: { detail: () => ({ desc: "Baujahr 2016/2017. " + GOOD, images: 4 }), ai: ai(), search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitUntil(() => genReqs(app.st).length >= 1, 20000, "analiza AI");
    assert.equal(await app.countLogs(/rocznik 2016 \(< 2017\)/), 0);
  } finally { await close(app); }
});

await test("B7: oszacowany rocznik 2016 z zakresem 2016–2019 → 2017, okazja nie odrzucona jako „stary”", async () => {
  let phase = 1;
  const B = { id: "2000000645", title: "Canyon Torque AL Zakres", price: 900 };
  const fakty = { rocznik: 2016, rocznik_zrodlo: "oszacowany", rocznik_zakres: "2016–2019", e_bike: false, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true };
  const app = await openApp({ world: { detail: () => ({ desc: GOOD, images: 4 }), ai: ai({ fakty }), search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitLog(/Oszacowany rocznik 2016, ale zakres 2016–2019 sięga 2017 — liczę 2017/, 20000);
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja");
  } finally { await close(app); }
});

await test("B7: Groq „stary” przy dircie bez podanego rocznika → analiza AI", async () => {
  let phase = 1;
  const D = { id: "2000000646", title: "Dirtbike 26 Zoll Custom", price: 500 };
  const app = await openApp({ cfg: { groqClassifierKey: "gsk_x", selectedBikes: ["canyon_torque"] }, world: { groq: () => groqResp("stary"), detail: () => ({ desc: GOOD, images: 4 }),
    ai: ai({ typ_roweru: "dirt", decyzja: "nie", szacowana_sprzedaz_eur: 520 }), search: (k) => phase >= 2 && k === "other" ? [D] : (k === "torque" ? [A] : []) } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitLog(/"stary" przy dircie bez podanego rocznika — decyzję zostawiam analizie AI — Dirtbike 26 Zoll Custom/, 20000);
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes("Dirtbike 26 Zoll Custom")), 20000, "analiza AI");
  } finally { await close(app); }
});

await test("B8: pełna pamięć przeglądarki → przycięcie czatu i udany zapis (z wpisem w logu)", async () => {
  const big = Array.from({ length: 200 }, (_, i) => ({ role: "user", text: "x".repeat(10000) + i }));
  const app = await openApp({ ls: { ddf_chat: big }, world: { search: (k) => k === "torque" ? [A] : [], detail: () => ({ desc: GOOD }) } });
  try {
    // dopełnij pamięć do samego limitu (czat ma ok. 2 mln znaków — po przycięciu do 30 wiadomości zwolni się miejsce)
    await app.page.evaluate(() => {
      let lo = 0, hi = 6e6;
      while (hi - lo > 2000) { const mid = Math.floor((lo + hi) / 2); try { localStorage.setItem("zz_fill", "x".repeat(mid)); lo = mid; } catch { hi = mid; } }
      localStorage.setItem("zz_fill", "x".repeat(lo));
    });
    await app.start();
    await app.waitLog(/Pamięć przeglądarki była pełna — przycięto ddf_chat/, 20000);
    const chat = JSON.parse(await app.ls("ddf_chat"));
    assert.equal(chat.length, 30);
    assert.ok(JSON.parse(await app.ls("ddf_seen")).some(e => e.id === A.id), "stan zapisany");
  } finally { await close(app); }
});

await test("„Niepewne” tuż nad progiem → weryfikacja i alert okazji (nie lista niepewnych)", async () => {
  let phase = 1;
  const B = { id: "2000000647", title: "YT Capra CF Pro Prog", price: 1200 };
  const first = analysisJson({ decyzja: "niepewne", niepewne_kategoria: "inne", cena_zakupu_eur: 1200, szacowana_sprzedaz_eur: 1609, przewidywany_zysk: 339, powod_decyzji: "Zysk tuż nad progiem" });
  const app = await openApp({ cfg: { profitTiers: [60, 40, 30, 27] }, world: { detail: () => ({ desc: GOOD, images: 6 }),
    ai: (b) => b.action ? {} : geminiResp(isVer(b) ? analysisJson({ cena_zakupu_eur: 1200, szacowana_sprzedaz_eur: 1609, przewidywany_zysk: 339 }) : first, { imagesAttached: b.imageUrls?.length || 0 }),
    search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitLog(/"niepewne" tuż nad progiem — zysk .* ≥ próg 27% → "tak", sprawdzi weryfikacja/, 20000);
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja po weryfikacji");
    assert.ok(genReqs(app.st).some(isVer));
  } finally { await close(app); }
});

await test("Wyszukiwanie całej marki: Groq „inny” dla „YT Capra Carbon” → znany model, analiza AI", async () => {
  let phase = 1;
  const Y = { id: "2000000648", title: "YT Capra Carbon Mountainbike 27,5 Zoll", price: 1200 };
  const app = await openApp({ cfg: { groqClassifierKey: "gsk_x", selectedBikes: ["yt"] }, world: { groq: () => groqResp("inny"), detail: () => ({ desc: GOOD, images: 4 }),
    ai: ai({ decyzja: "nie", szacowana_sprzedaz_eur: 1300 }), search: (k) => phase >= 2 ? [Y] : [A] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitLog(/Groq: "inny", ale tytuł to znany model .* — YT Capra Carbon/, 20000);
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes("YT Capra Carbon")), 20000, "analiza AI");
  } finally { await close(app); }
});

await test("Katalog e-MTB: Cube Stereo Hybrid dostaje wpis e-MTB marki i zasady e-MTB; zwykły full — nie", async () => {
  let phase = 1;
  const E = { id: "2000000649", title: "Cube Stereo Hybrid 140 HPC 625 2021", price: 1300 };
  const F = { id: "2000000650", title: "Cube Stereo 140 HPC Race 2021", price: 1200 };
  const app = await openApp({ cfg: { selectedBikes: ["cube_stereo"] }, world: { detail: () => ({ desc: GOOD, images: 4 }), ai: ai({ decyzja: "nie", szacowana_sprzedaz_eur: 1350 }),
    search: () => phase >= 2 ? [E, F] : [A] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitUntil(() => genReqs(app.st).length >= 2, 25000, "dwie analizy");
    const pe = promptOf(genReqs(app.st).find(b => promptOf(b).includes(E.title)));
    const pf = promptOf(genReqs(app.st).find(b => promptOf(b).includes(F.title)));
    assert.ok(pe.includes("BAZA CEN — e-MTB Cube") && pe.includes("e-MTB: ZASADY I KATEGORIE"), "e-MTB z katalogiem");
    assert.ok(pe.includes("Cube Stereo Hybrid 140 HPC — e-MTB"));
    assert.ok(!pf.includes("BAZA CEN — e-MTB Cube"), "zwykły full bez katalogu e-MTB");
  } finally { await close(app); }
});

await test("Linki: „tylko oferty” we wszystkich wyszukiwaniach, górna cena także w linkach kategorii", async () => {
  const urls = [];
  const app = await openApp({ world: { search: (k, n, st, url) => { urls.push(url); return k === "torque" ? [A] : []; } } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/);
    assert.ok(urls.some(u => u.includes("/s-fahrraeder/anzeige:angebote/preis:250:1400/dirt/k0c217")), urls.join(" | "));
    assert.ok(urls.some(u => u.includes("/s-fahrraeder/anzeige:angebote/preis:200:1400/dirtbike/k0c217")));
    assert.ok(urls.every(u => u.includes("anzeige:angebote")));
  } finally { await close(app); }
});

// U2: obecny układ kart Kleinanzeigen (13.11.2026) — znaczniki jak na żywej stronie, treść wymyślona
const NEW_CARD = (id, title, price, loc) => `<article class="flex justify-between p-medium" data-adid="${id}" data-href="/s-anzeige/rad-${id}/${id}-217-8992"><div class="relative z-raised basis-[200px]"><a class="inline-flex" href="/s-anzeige/rad-${id}/${id}-217-8992"><div class="relative flex h-[150px] w-[200px]" data-image-container=""><img class="size-full object-cover" src="https://img.kleinanzeigen.de/api/v1/prod-ads/images/7c/abc${id}?rule=$_2.AUTO" alt="${title} Vorschau"><div class="absolute bottom-xsmall right-xsmall">12</div></div></a></div><div class="z-raised flex grow basis-[398px] flex-col overflow-hidden pl-medium"><div class="mb-xsmall flex items-start justify-between text-bodyRegular"><div class="flex items-center gap-xxsmall text-onSurfaceNonessential"><span>${loc}</span></div><div class="flex items-center gap-xxsmall text-onSurfaceNonessential"><span>Heute, 14:47</span></div></div><div class="flex flex-col"><h3 class="mb-xsmall line-clamp-2 text-title3 font-strong hover:underline"><a class="inline-flex" href="/s-anzeige/rad-${id}/${id}-217-8992">${title}</a></h3><p class="mb-xsmall text-bodyRegular text-onSurfaceSubdued">Ich verkaufe mein Fahrrad in gutem Zustand, regelmäßig gewartet...</p><div class="flex"><p class="my-xsmall text-title3 font-strong text-secondary">${price}</p></div></div><div><p class="flex"></p></div></div></article>`;
const NEW_DETAIL = `<html><head><meta property="og:image" content="https://img.kleinanzeigen.de/api/v1/prod-ads/images/1f/fix1?rule=$_59.JPG"></head><body>
<h1 id="viewad-title" class="boxedarticle--title" itemprop="name" data-soldlabel="Verkauft"> Canyon Torque AL Neu Layout</h1>
<h2 class="boxedarticle--price" id="viewad-price"> 1.100 € VB</h2>
<span id="viewad-locality" itemprop="addressLocality"> 85051 Bayern - Ingolstadt</span>
<div class="galleryimage-element"><img src="https://img.kleinanzeigen.de/api/v1/prod-ads/images/cf/fix2?rule=$_59.AUTO" data-imgsrc="https://img.kleinanzeigen.de/api/v1/prod-ads/images/cf/fix2?rule=$_59.AUTO"></div>
<p id="viewad-description-text" class="text-force-linebreak " itemprop="description"> Verkaufe mein Canyon Torque AL, Modell 2021, Fox 38, Super Deluxe.<br><br>Zustand: Service 2025, technisch top, normale Gebrauchsspuren.</p>
<div id="viewad-contact" itemprop="seller" itemscope=""><ul class="iconlist"><li><i class="iconlist-icon-big"><a href="/s-bestandsliste.html?userId=12345678" class="badge user-profile-vip-badge">V</a></i><span class="iconlist-text"><a href="/s-bestandsliste.html?userId=12345678">Verkäufer</a></span></li></ul></div>
</body></html>`;

await test("U2: obecny układ kart (h3, cena „650 € VB”, lokalizacja w <span>) i strony ogłoszenia (sprzedawca, opis, cena)", async () => {
  let phase = 1;
  const app = await openApp({ world: { search: (k) => k === "torque" ? [A] : [], ai: ai({ decyzja: "nie", szacowana_sprzedaz_eur: 1150 }) } });
  try {
    await app.page.route("**/api/scrape?*", (route) => {
      const t = decodeURIComponent(new URL(route.request().url()).searchParams.get("url"));
      if (t.includes("/s-anzeige/")) return route.fulfill({ body: NEW_DETAIL, contentType: "text/html" });
      if (/Canyon%20Torque|Canyon Torque/.test(t) && phase >= 2) return route.fulfill({ contentType: "text/html",
        body: `<html><body>${NEW_CARD("3000000651", "Canyon Torque AL Neu Layout", "1.100 € VB", "71067 Sindelfingen")}${NEW_CARD("3000000652", "Canyon Torque EX", "650 € VB", "97877 Wertheim")}</body></html>` });
      return route.fallback();
    });
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitUntil(async () => (JSON.parse((await app.ls("ddf_seen")) || "[]")).some(e => e.id === "3000000652"), 20000, "karty w nowym układzie");
    const seen = JSON.parse(await app.ls("ddf_seen"));
    assert.equal(seen.find(e => e.id === "3000000651").price, 1100);
    assert.equal(seen.find(e => e.id === "3000000652").price, 650);
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes("Fox 38, Super Deluxe")), 20000, "analiza z opisem ze strony ogłoszenia");
    await app.waitQueueEmpty();
    const dupes = JSON.parse(await app.ls("ddf_dupes"));
    assert.equal(dupes["3000000651"]?.seller, "12345678", "numer sprzedawcy ze strony ogłoszenia");
  } finally { await close(app); }
});

await test("Nocne sprawdzanie cen: obniżka przy wycenie → analiza; za drogie → do zakresu → analiza; usunięte wypada; odrzucone na stałe pomijane", async () => {
  const old = Date.now() - 3 * 24 * 3600e3;
  const seen = [
    { id: "2000000661", price: 445, lowest: 445, type: "full", lastSeenAt: old, watchSale: 770, watchT: 70 },
    { id: "2000000662", price: 1600, lowest: 1600, overMax: true, lastSeenAt: old },
    { id: "2000000663", price: 1600, lowest: 1600, overMax: true, lastSeenAt: old },
    { id: "2000000664", price: 1500, lowest: 1500, overMax: true, lastSeenAt: old, rej: "stary" },
    { id: "2000000665", price: 1500, lowest: 1500, overMax: true, lastSeenAt: old },
    { id: "2000000666", price: 900, lowest: 900, lastSeenAt: old },
  ];
  const det = { "2000000661": { desc: GOOD, price: 437, title: "Canyon Torque AL Nacht" }, "2000000662": { desc: GOOD, price: 1350, title: "Canyon Torque CF Nacht" },
    "2000000663": { desc: GOOD, price: 1600, title: "Canyon Torque CF Teuer" }, "2000000665": { status: 404 } };
  const app = await openApp({ cfg: { profitTiers: [60, 40, 30, 20], nightCheckHour: new Date().getHours() }, ls: { ddf_seen: seen },
    world: { search: (k) => k === "torque" ? [A] : [], detail: (id) => det[id] || { desc: GOOD }, ai: ai({ decyzja: "nie", cena_zakupu_eur: 437, szacowana_sprzedaz_eur: 770 }) } });
  try {
    await app.start();
    await app.waitLog(/Nocne sprawdzanie cen: 4 ogłoszeń/, 15000);
    await app.waitLog(/Nocne sprawdzanie cen zakończone: sprawdzono 4\/4 · obniżek 2 · do analizy 2 · usuniętych z Kleinanzeigen 1/, 20000);
    assert.ok(!app.st.detailCalls.includes("2000000664"), "odrzucony na stałe nie sprawdzany");
    assert.ok(!app.st.detailCalls.includes("2000000666"), "bez wyceny i nie za drogi — nie sprawdzany");
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes("Canyon Torque AL Nacht")), 20000, "analiza obniżki z wyceną");
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes("Canyon Torque CF Nacht")), 20000, "analiza za drogiego po obniżce");
    const s2 = JSON.parse(await app.ls("ddf_seen"));
    assert.ok(!s2.some(e => e.id === "2000000665"), "usunięte wypadło z pamięci");
    assert.ok(!genReqs(app.st).some(b => promptOf(b).includes("Canyon Torque CF Teuer")));
    await app.waitLog(/Cykl #2 zakończony/, 20000);
    assert.equal(await app.countLogs(/Nocne sprawdzanie cen: 4 ogłoszeń/), 1, "jedna runda na noc");
  } finally { await close(app); }
});

for (const r of results) console.log(r);
await closeBrowser();
if (results.some(r => r.startsWith("❌"))) process.exit(1);
