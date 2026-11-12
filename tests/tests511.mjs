import { openApp, closeBrowser, analysisJson, geminiResp, groqResp } from "./harness.mjs";
import assert from "node:assert/strict";
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const B = { id: "2000000002", title: "Canyon Torque AL 6 2021 L", price: 900, date: "Heute, 10:00" };
const GOOD = "Sehr gepflegtes Canyon Torque AL 6, Fox 38 Performance, Float X2, SRAM GX Eagle, Code R Bremsen, Größe L, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const NEAR_HOOK = "https://discord.com/api/webhooks/3/near";
const STATUS_HOOK = "https://discord.com/api/webhooks/4/status";
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 300)}`); } }
const twoPhase = async (opts, after) => {
  let phase = 1;
  const app = await openApp({ ...opts, world: { detail: () => ({ desc: GOOD, images: 3 }), ...opts.world, search: (k, n, st) => k !== "torque" ? [] : [A, ...(phase >= 2 ? (opts.newOnes || [B]) : [])] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
};
const okAi = (o = {}) => (b) => b.action ? {} : geminiResp(analysisJson(o), { imagesAttached: b.imageUrls?.length || 0 });

await test("Tytuł „180er” / „2000 km” nie odrzuca roweru; „2015” odrzuca", async () => {
  const C = { id: "3000000003", title: "Canyon Torque CF 8 180er Fox 38", price: 900 };
  const D = { id: "4000000004", title: "Trek Slash 8 nur 2000 km gefahren", price: 900 };
  const E = { id: "5000000005", title: "Canyon Torque 2015 Top", price: 900 };
  await twoPhase({ newOnes: [C, D, E], world: { ai: okAi({ decyzja: "nie", szacowana_sprzedaz_eur: 950 }) } }, async (app) => {
    await app.waitLog(/Filtr roku: odrzucono \(rok 2015/);
    await app.waitUntil(async () => (await app.countLogs(/etap 2\): analizuję/)) >= 2, 20000, "2 analizy");
    assert.equal(await app.countLogs(/Filtr roku: odrzucono.*(180er|2000 km)/), 0);
  });
});

await test("Cena 150 € → odrzucona bez AI (minimum 200 €)", async () => {
  await twoPhase({ newOnes: [{ ...B, price: 150 }], world: { ai: okAi() } }, async (app) => {
    await app.waitLog(/cena 150€ poniżej minimum 200€/);
    await app.waitLog(/Cykl #2 zakończony/);
    assert.equal(genReqs(app.st).length, 0);
  });
});

await test("Brak ceny → bez Groqa; gdy cena się pojawi → analiza", async () => {
  let phase = 1;
  const app = await openApp({ cfg: { groqClassifierKey: "gsk_x" }, world: { groq: () => groqResp("full"), detail: () => ({ desc: GOOD }), ai: okAi({ decyzja: "nie", szacowana_sprzedaz_eur: 950 }),
    search: (k) => k !== "torque" ? [] : [A, ...(phase === 2 ? [{ ...B, price: "VB" }] : phase >= 3 ? [B] : [])] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitLog(/Brak ceny — odrzucono bez AI/);
  assert.equal(app.st.groqReqs.length, 0, "bez Groqa");
  await app.waitLog(/Cykl #2 zakończony/); phase = 3;
  await app.waitLog(/pojawiła się cena: .* → 900€/);
  await app.waitUntil(() => genReqs(app.st).length >= 1, 15000, "analiza");
  const seen = JSON.parse(await app.ls("ddf_seen"));
  assert.ok(seen.every(e => /^\d+$/.test(e.id)), "klucze = numery ogłoszeń");
  await app.stop(); await app.waitStopped(); await app.close();
});

await test("Migracja: stare klucze z linkiem → numer; oferta nie wraca jako nowa", async () => {
  const hrefA = `https://www.kleinanzeigen.de/s-anzeige/stary-tytul/${A.id}-217-1234`;
  const app = await openApp({ ls: { ddf_seen: [{ id: hrefA, price: 1000, lowest: 1000 }], ddf_scan_state: { searches: { canyon_torque: { baselineAt: Date.now(), lastScanAt: Date.now() } } } },
    world: { search: () => [A], ai: okAi() } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/);
  assert.equal(await app.countLogs(/nowych ogłoszeń/), 0);
  const seen = JSON.parse(await app.ls("ddf_seen"));
  assert.deepEqual(seen.map(e => e.id), [A.id]);
  assert.ok(seen[0].lastSeenAt > 0);
  await app.stop(); await app.waitStopped(); await app.close();
});

await test("Brak środków Claude → oferta czeka w kolejce, komunikat o problemie (raz)", async () => {
  await twoPhase({ cfg: { geminiModel: "claude-haiku-5-5", strongModel: "claude-haiku-5-5", claudeKey: "sk-ant-x", statusWebhook: STATUS_HOOK },
    world: { ai: () => ({ __status: 400, __json: { error: { message: "Claude HTTP 400 invalid_request_error: Your credit balance is too low to access the Anthropic API.", code: 400 } } }) } }, async (app) => {
    await app.waitLog(/Analizy AI wstrzymane/);
    await app.waitLog(/Cykl #3 zakończony/, 30000);
    const pend = JSON.parse(await app.ls("ddf_pending"));
    assert.equal(pend.length, 1, "oferta w kolejce");
    assert.ok(!app.st.discord.some(d => d.webhookUrl.includes("/2/")), "nic do niepewnych");
    const status = app.st.discord.filter(d => d.webhookUrl === STATUS_HOOK);
    assert.equal(status.length, 1, "jeden komunikat");
    assert.ok(status[0].payload.content.includes("credit balance"));
  });
});

await test("AI „nie”, ale z liczb zysk ≥ progu → weryfikacja → okazja", async () => {
  let n = 0;
  await twoPhase({ world: { ai: (b) => { if (b.action) return {}; n++; return geminiResp(analysisJson(n === 1 ? { decyzja: "nie", szacowana_sprzedaz_eur: 1500 } : {}), { imagesAttached: b.imageUrls?.length || 0 }); } } }, async (app) => {
    await app.waitLog(/liczby decydują: "tak"/);
    await app.waitUntil(() => app.st.discord.some(d => d.payload.embeds), 20000, "okazja");
    assert.ok(genReqs(app.st).some(isVer));
  });
});

await test("Okazja: zdjęcie, rozmiar i „dodano” w alercie; analiza zaraz po wyszukiwaniu", async () => {
  let phase = 1;
  let discordAtSlash = null; // v5.14: rutynowych linii „🔍 Trek Slash…” już nie ma w logu — kolejność sprawdzamy po zapytaniach
  const app = await openApp({ cfg: { selectedBikes: ["canyon_torque", "trek_slash"] }, world: { detail: () => ({ desc: GOOD, images: 3 }), ai: okAi({ rozmiar_ramy: "L" }),
    search: (k, n, st) => { if (k === "slash" && phase >= 2 && discordAtSlash == null) discordAtSlash = st.discord.filter(d => d.payload.embeds).length; return k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : []; } } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitUntil(() => app.st.discord.some(d => d.payload.embeds), 20000, "okazja");
  const e = app.st.discord.find(d => d.payload.embeds).payload.embeds[0];
  assert.ok(e.image?.url?.startsWith("https://img.kleinanzeigen.de/"), "zdjęcie");
  assert.equal(e.fields.find(f => f.name.includes("Rozmiar")).value, "L");
  assert.ok(e.fields.find(f => f.name.includes("Dodano")).value.includes("temu"));
  // v6.3: analiza idzie w tle (wykonawca AI), więc kolejne wyszukiwanie NIE czeka na alert — kolejności już nie sprawdzamy
  await app.stop(); await app.waitStopped(); await app.close();
});

await test("Na granicy: 900 € / sprzedaż 1100 € → propozycja 750 € (v5.12) z wiadomością po niemiecku", async () => {
  await twoPhase({ cfg: { nearWebhook: NEAR_HOOK }, world: { ai: okAi({ decyzja: "nie", szacowana_sprzedaz_eur: 1100, argumenty_negocjacji: "Baujahr 2018; Kette bald fällig" }) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.some(d => d.webhookUrl === NEAR_HOOK), 20000, "na granicy");
    const e = app.st.discord.find(d => d.webhookUrl === NEAR_HOOK).payload.embeds[0];
    const f = (s) => e.fields.find(x => x.name.includes(s)).value;
    assert.equal(f("Opłaca się do"), "**858€**");
    assert.ok(f("Proponuj").startsWith("**750€**"));
    const msg = f("Wiadomość");
    assert.ok(msg.includes("750 € anbieten") && msg.includes("Baujahr 2018, Kette bald fällig."), msg);
    assert.ok(!app.st.discord.some(d => d.payload.embeds?.[0]?.title?.startsWith("🚲")), "bez alertu okazji");
  });
});

await test("Sprzeczny typ (Groq full, AI dirt) → typ od AI, okazja z adnotacją", async () => {
  await twoPhase({ cfg: { groqClassifierKey: "gsk_x" }, world: { groq: () => groqResp("full"), ai: okAi({ typ_roweru: "dirt" }) } }, async (app) => {
    await app.waitLog(/przyjmuję typ od AI/);
    await app.waitUntil(() => app.st.discord.some(d => d.payload.embeds), 20000, "okazja");
    const e = app.st.discord.find(d => d.payload.embeds).payload.embeds[0];
    assert.ok(e.fields.find(x => x.name.includes("Typ")).value.includes("Dirt"));
    assert.ok(e.fields.find(x => x.name.includes("Weryfikacja")).value.includes("sprzeczny typ rozstrzygnięty: „dirt” (Groq: „full”)"));
  });
});

await test("Nieczytelne ceny na liście → wyszukiwanie pominięte, nic nie oznaczone jako widziane", async () => {
  const many = [1, 2, 3, 4, 5].map(i => ({ id: `600000000${i}`, title: `Canyon Torque ${i}`, price: "VB" }));
  const app = await openApp({ cfg: { statusWebhook: STATUS_HOOK }, ls: { ddf_scan_state: { searches: { canyon_torque: { baselineAt: Date.now(), lastScanAt: Date.now() } } } },
    world: { search: () => many, ai: okAi() } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/);
  await app.waitLog(/nie odczytano cen większości ogłoszeń/);
  assert.equal(await app.ls("ddf_seen"), null);
  assert.ok(app.st.discord.some(d => d.webhookUrl === STATUS_HOOK && d.payload.content.includes("nie odczytuje cen")));
  await app.stop(); await app.waitStopped(); await app.close();
});

await test("2 blokady wyszukiwań pod rząd → przerwa i komunikat", async () => {
  const app = await openApp({ cfg: { selectedBikes: ["canyon_torque", "trek_slash", "canyon_spectral"], statusWebhook: STATUS_HOOK }, world: { search: () => [A], ai: okAi() } });
  await app.page.route("**/api/scrape?*", (route) => {
    const t = decodeURIComponent(new URL(route.request().url()).searchParams.get("url"));
    if (!t.includes("/s-anzeige/")) return route.fulfill({ status: 403, body: "nope", contentType: "text/html" });
    return route.fallback();
  });
  await app.start();
  await app.waitLog(/Kleinanzeigen blokuje wyszukiwania \(2 pod rząd\)/);
  await app.waitLog(/Wyszukiwania wstrzymane po blokadzie/, 20000);
  assert.equal(await app.countLogs(/Trek Slash…/), 0, "trzecie wyszukiwanie pominięte");
  assert.ok(app.st.discord.some(d => d.webhookUrl === STATUS_HOOK && d.payload.content.includes("blokuje wyszukiwania")));
  await app.stop(); await app.waitStopped(); await app.close();
});

await closeBrowser();
console.log(results.join("\n"));
process.exit(results.some(r => r.startsWith("❌")) ? 1 : 0);
