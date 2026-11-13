import { openApp, closeBrowser, analysisJson, geminiResp, groqResp } from "./harness.mjs";
import assert from "node:assert/strict";
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const GOOD = "Sehr gepflegtes Bike, Fox 38 Performance, Float X2, SRAM GX Eagle, Code R Bremsen, Größe L, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const NEAR_HOOK = "https://discord.com/api/webhooks/3/near";
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${e.message}`); } }
const twoPhase = async (opts, after) => {
  let phase = 1;
  const app = await openApp({ ...opts, world: { detail: () => ({ desc: GOOD, images: 3 }), ...opts.world, search: (k) => k !== "torque" ? [] : [A, ...(phase >= 2 ? opts.newOnes : [])] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
};
const okAi = (o = {}) => (b) => b.action ? {} : geminiResp(analysisJson(o), { imagesAttached: b.imageUrls?.length || 0 });

await test("Usunięte ogłoszenie (strona zastępcza 200 z innymi ofertami) → pominięte, bez analizy", async () => {
  const B = { id: "2000000002", title: "Canyon Torque AL 6 2021", price: 900 };
  await twoPhase({ newOnes: [B], world: { ai: okAi(), detail: () => ({ status: 200, body: `<html><head><link rel="canonical" href="https://www.kleinanzeigen.de/s-fahrraeder/berlin/c217l3331"><script type="application/ld+json">{"@type":"ImageObject","title":"Inny rower","description":"${GOOD}"}</script></head><body><article data-adid="1">x</article></body></html>` }) } }, async (app) => {
    await app.waitLog(/Ogłoszenie już usunięte — pomijam/);
    assert.equal(genReqs(app.st).length, 0);
  });
});

await test("Groq „stary” dla znanej dirtówki → nie odrzuca, analiza AI", async () => {
  const B = { id: "2000000003", title: "Rose the Bruce zwei", price: 600 };
  await twoPhase({ newOnes: [B], cfg: { groqClassifierKey: "gsk_x" }, world: { groq: () => groqResp("stary"), ai: okAi({ typ_roweru: "dirt", decyzja: "nie", szacowana_sprzedaz_eur: 650 }) } }, async (app) => {
    await app.waitLog(/tytuł to znany model \(dirt\)|„stary” przy dircie bez podanego rocznika|"stary" przy dircie bez podanego rocznika/); // v6.4: nowa reguła dla dirtów łapie to wcześniej
    await app.waitUntil(() => genReqs(app.st).length >= 1, 15000, "analiza AI");
  });
});

await test("Groq „inny” dla ramy znanego modelu → odrzucone z powodem w Wynikach", async () => {
  const B = { id: "2000000004", title: "Canyon Torque Rahmen Größe L", price: 600 };
  await twoPhase({ newOnes: [B], cfg: { groqClassifierKey: "gsk_x" }, world: { groq: () => groqResp("inny"), ai: okAi() } }, async (app) => {
    await app.waitLog(/Groq: typ "inny" — odrzucono/);
    assert.equal(genReqs(app.st).length, 0);
    await app.page.getByRole("button", { name: "📋 Wyniki" }).click();
    assert.ok((await app.page.textContent("body")).includes("powód: „powód testowy”"));
  });
});

await test("Na granicy: cena musi spaść o >20% → brak alertu", async () => {
  const B = { id: "2000000005", title: "Canyon Torque AL 7", price: 1300 };
  await twoPhase({ newOnes: [B], cfg: { nearWebhook: NEAR_HOOK }, world: { ai: okAi({ decyzja: "nie", cena_zakupu_eur: 1300, szacowana_sprzedaz_eur: 1300 }) } }, async (app) => {
    await app.waitLog(/NIE opłaca się/);
    await app.waitLog(/Cykl #2 zakończony/);
    assert.ok(!app.st.discord.some(d => d.webhookUrl === NEAR_HOOK));
  });
});

await test("„Niepewne” z kompletnymi liczbami poniżej progu → „nie” i alert na granicy", async () => {
  const B = { id: "2000000006", title: "Canyon Torque CF 7 2022", price: 1400 };
  await twoPhase({ newOnes: [B], cfg: { nearWebhook: NEAR_HOOK, minProfit: 35 }, world: { ai: okAi({ decyzja: "niepewne", niepewne_kategoria: "inne", cena_zakupu_eur: 1400, szacowana_sprzedaz_eur: 1931 }) } }, async (app) => {
    await app.waitLog(/"niepewne", ale liczby są kompletne/);
    await app.waitUntil(() => app.st.discord.some(d => d.webhookUrl === NEAR_HOOK), 20000, "na granicy");
    assert.ok(!app.st.discord.some(d => d.webhookUrl.includes("/2/")), "bez listy niepewnych");
  });
});

await test("Rocznik oszacowany jako zakres w alercie; skrót bez powtórzeń", async () => {
  const B = { id: "2000000007", title: "Canyon Torque AL 5", price: 900 };
  await twoPhase({ newOnes: [B], world: { ai: okAi({ fakty: { rocznik: 2017, rocznik_zrodlo: "oszacowany", rocznik_zakres: "2017-2019", e_bike: false, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true }, ostrzezenia: "sprawdź łożyska" }) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.some(d => d.payload.embeds), 20000, "okazja");
    const e = app.st.discord.find(d => d.payload.embeds).payload.embeds[0];
    const f = (s) => e.fields.find(x => x.name.includes(s))?.value;
    assert.equal(f("Rocznik"), "2017–2019 (oszac.)");
    assert.ok(!f("Krótki opis").includes("⚠️") && !f("Krótki opis").includes("📷"), f("Krótki opis"));
    assert.ok(!e.fields.some(x => x.name.includes("Lokalizacja") && x.value === "–"), "brak pustego pola lokalizacji");
  });
});

await test("Dziennik zdarzeń zapisuje start i wysłany alert; autostart po odświeżeniu", async () => {
  const B = { id: "2000000008", title: "Canyon Torque AL 6", price: 900 };
  await twoPhase({ newOnes: [B], world: { ai: okAi() } }, async (app) => {
    await app.waitUntil(() => app.st.discord.some(d => d.payload.embeds), 20000, "okazja");
    await app.waitLog(/Wysłano na Discord/);
    const ev = JSON.parse(await app.ls("ddf_events"));
    assert.ok(ev.some(e => /^🚀/.test(e.msg)) && ev.some(e => /Wysłano na Discord/.test(e.msg)), JSON.stringify(ev).slice(0, 300));
    assert.equal(await app.ls("ddf_autorun"), "1");
  });
  const app2 = await openApp({ ls: { ddf_autorun: "1" }, world: { search: () => [A], ai: okAi() } });
  await app2.waitLog(/Autostart/);
  await app2.waitLog(/Cykl #1 zakończony/, 20000);
  await app2.stop(); await app2.waitStopped();
  assert.equal(await app2.ls("ddf_autorun"), null, "STOP wyłącza autostart");
  await app2.close();
});

await test("Wyszukiwania modeli z typem Mountainbike + E-Bike", async () => {
  const urls = [];
  const app = await openApp({ world: { search: () => [A], ai: okAi() } });
  app.page.on("request", r => { if (r.url().includes("/api/scrape")) urls.push(new URL(r.url()).searchParams.get("url")); });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/);
  assert.ok(urls.some(u => u.includes("Canyon%20Torque/k0c217+fahrraeder.type_s:(ebike%2Cmountainbike)")), urls[0]);
  await app.stop(); await app.waitStopped(); await app.close();
});

await test("Nowy filtr wyszukiwania: stare, nowo widoczne oferty nie idą do analizy", async () => {
  const OLD = { id: "3000000001", title: "Canyon Torque:ON CF 8", price: 1200, date: "01.11.2026" };
  const NEW = { id: "3000000002", title: "Canyon Torque AL 6", price: 900, date: "Heute, 10:00" };
  const app = await openApp({ ls: { ddf_seen: [{ id: A.id, price: 1000, lowest: 1000, lastSeenAt: Date.now() }], ddf_scan_state: { searches: { canyon_torque: { baselineAt: Date.now() - 3600e3, lastScanAt: Date.now() - 120e3, lastNewAt: Date.now() } } } },
    world: { search: () => [A, OLD, NEW], detail: () => ({ desc: GOOD, images: 2 }), ai: okAi({ decyzja: "nie", szacowana_sprzedaz_eur: 950 }) } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/, 30000);
  await app.waitLog(/nowy filtr wyszukiwania \(zakres cen \/ typ roweru\) — analizuję 1 ofert z ostatnich 24 h, pomijam 1 starszych/);
  const st = JSON.parse(await app.ls("ddf_scan_state"));
  assert.equal(st.searches.canyon_torque.urlVersion, 4); // v6.4: wersja 4 = „tylko oferty” + zakres cen
  assert.equal(st.searches.canyon_torque.priceRange, "200:1400");
  await app.stop(); await app.waitStopped(); await app.close();
});

await closeBrowser();
console.log(results.join("\n"));
process.exit(results.some(r => r.startsWith("❌")) ? 1 : 0);
