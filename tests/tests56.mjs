import { openApp, closeBrowser, analysisJson, geminiResp, groqResp } from "./harness.mjs";
import assert from "node:assert/strict";

const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isGen = (b) => !b.action;
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(isGen);
const titlesAnalyzed = (st) => genReqs(st).filter(b => !isVer(b)).map(b => (promptOf(b).match(/Tytuł: (.*)/) || [])[1]);
const defaultAi = (over = {}) => (b) => b.action ? {} : geminiResp(analysisJson(over));
const L = (id, title, price, extra = {}) => ({ id, title, price, ...extra });
const A = L("1000000001", "Canyon Torque AL alt", 1000);
const B = L("2000000002", "Canyon Torque AL 6 2021 L", 900);
const C = L("3000000003", "Canyon Torque CF 8 2022", 950);
const D = L("4000000004", "Canyon Torque AL 5 2020", 850);

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([name, "OK", Date.now() - t0]); console.log(`✅ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { results.push([name, "FAIL", Date.now() - t0, e.message]); console.log(`❌ ${name}: ${e.stack?.split("\n").slice(0, 3).join(" | ")}`); }
}

// ── F04 + pierwszy skan: nowa instalacja → zapamiętanie; nowa oferta → analiza; STOP → nowa oferta → START analizuje od razu ──
await test("F04 restart nie gubi ofert z przerwy", async () => {
  let phase = 1;
  const app = await openApp({ world: {
    search: () => [A, ...(phase >= 2 ? [B] : []), ...(phase >= 3 ? [C] : [])],
    ai: defaultAi(),
  } });
  await app.start();
  await app.waitLog(/pierwsze skanowanie tego wyszukiwania — zapamiętano 1/);
  await app.waitLog(/Cykl #1 zakończony/);
  assert.equal(genReqs(app.st).length, 0, "cykl 1 bez analizy");
  phase = 2;
  await app.waitUntil(() => app.st.discord.length >= 1, 15000, "okazja B wysłana");
  assert.deepEqual(titlesAnalyzed(app.st), [B.title]);
  await app.stop(); await app.waitStopped();
  phase = 3;
  await app.start();
  await app.waitUntil(() => titlesAnalyzed(app.st).includes(C.title), 15000, "C przeanalizowane po restarcie");
  assert.equal(await app.countLogs(/Canyon Torque: pierwsze skanowanie/), 1, "bez drugiego zapamiętywania");
  await app.stop(); await app.waitStopped();
  await app.close();
});

// ── F02: limit 1 analizy na cykl — druga oferta czeka w kolejce i jest analizowana w następnym cyklu ──
await test("F02 oferta ponad limit wraca w kolejnym cyklu", async () => {
  let phase = 1;
  const app = await openApp({ cfg: { maxGeminiPerCycle: 1 }, world: {
    search: () => [A, ...(phase >= 2 ? [B, C] : [])],
    ai: defaultAi({ decyzja: "nie", szacowana_sprzedaz_eur: 950 }),
  } });
  await app.start();
  await app.waitLog(/Cykl #1 zakończony/);
  phase = 2;
  await app.waitUntil(() => titlesAnalyzed(app.st).length >= 2, 20000, "obie oferty przeanalizowane");
  assert.equal(new Set(titlesAnalyzed(app.st)).size, 2);
  await app.waitLog(/W kolejce do analizy AI: \d/); // v6.3: analizy w tle — stan kolejki na końcu cyklu
  await app.stop(); await app.waitStopped();
  assert.equal(JSON.parse(await app.ls("ddf_pending")).length, 0, "kolejka pusta");
  await app.close();
});

// ── F03: błąd AI — oferta zostaje w kolejce; v5.14: jedna próba na cykl i odstęp 10 min przed kolejną ──
await test("F03 błąd AI: oferta zostaje w kolejce, bez ponawiania w tym samym cyklu", async () => {
  let phase = 1;
  const app = await openApp({ world: {
    search: () => [A, ...(phase >= 2 ? [B] : [])],
    ai: (b) => b.action ? {} : { __status: 500, __json: { error: { message: "Internal error" } } },
  } });
  await app.start();
  await app.waitLog(/Cykl #1 zakończony/);
  phase = 2;
  await app.waitLog(/zostaje w kolejce \(próba 1\/3, następna za 10 min\)/);
  await app.waitLog(/Cykl #3 zakończony/, 30000);
  assert.equal(app.st.aiReqs.filter(b => !b.action).length, 1, "tylko jedno zapytanie AI w 2 cyklach");
  assert.equal(await app.countLogs(/próba 2\/3/), 0, "druga próba dopiero po 10 min");
  const pend = JSON.parse(await app.ls("ddf_pending"));
  assert.equal(pend.length, 1); assert.equal(pend[0].attempts, 1); assert.ok(pend[0].nextAttemptAt > Date.now());
  await app.stop(); await app.waitStopped();
  await app.close();
});

// ── F05: bez klucza Groq tania oferta idzie do analizy; z kluczem i prawdziwym "niepewne" — próg ceny działa ──
await test("F05 wyłączony Groq nie odrzuca taniej oferty", async () => {
  let phase = 1;
  const cheap = L("5000000005", "Canyon Torque AL 400 Euro", 400);
  const app = await openApp({ world: { search: () => [A, ...(phase >= 2 ? [cheap] : [])], ai: defaultAi({ decyzja: "nie", szacowana_sprzedaz_eur: 420 }) } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitUntil(() => titlesAnalyzed(app.st).includes(cheap.title), 15000, "tania oferta przeanalizowana");
  await app.stop(); await app.waitStopped(); await app.close();

  let phase2 = 1;
  const app2 = await openApp({ cfg: { groqClassifierKey: "gsk_test" }, world: {
    search: () => [A, ...(phase2 >= 2 ? [cheap] : [])], ai: defaultAi(), groq: () => groqResp("niepewne") } });
  await app2.start(); await app2.waitLog(/Cykl #1 zakończony/); phase2 = 2;
  await app2.waitLog(/niepewny typ \+ cena 400€ < 500€/);
  assert.equal(titlesAnalyzed(app2.st).length, 0);
  await app2.stop(); await app2.waitStopped(); await app2.close();
});

// ── F06: budżet 0 zł — żadnego płatnego wywołania, oferta czeka w kolejce ──
await test("F06 budżet to twardy limit", async () => {
  let phase = 1;
  const app = await openApp({ cfg: { aiBudgetPln: 0 }, world: { search: () => [A, ...(phase >= 2 ? [B] : [])], ai: defaultAi() } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitLog(/wstrzymuję analizy/);
  assert.equal(app.st.aiReqs.length, 0, "zero zapytań AI (także cache)");
  await app.stop(); await app.waitStopped();
  const pend = JSON.parse(await app.ls("ddf_pending"));
  assert.equal(pend.length, 1); assert.equal(pend[0].listing.title, B.title);
  await app.close();
});

// ── F07: Discord 403 dla listy niepewnych — błąd w logu, lista czeka; po naprawie — wysłana ──
await test("F07 odmowa Discorda nie udaje sukcesu", async () => {
  let phase = 1, discordOk = false;
  const app = await openApp({ world: {
    search: () => [A, ...(phase >= 2 ? [B] : [])],
    ai: defaultAi({ decyzja: "niepewne", niepewne_kategoria: "za_malo_opisu" }),
    discord: (b) => b.webhookUrl.includes("/2/") && !discordOk ? { ok: false, status: 403, retryAfter: null, error: "Unknown Webhook" } : { ok: true, status: 204 },
  } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitLog(/Lista niepewnych NIE wysłana \(webhook nieprawidłowy/);
  assert.equal(await app.countLogs(/Wysłano listę/), 0);
  assert.equal(JSON.parse(await app.ls("ddf_outbox")).length, 1);
  discordOk = true;
  await app.waitLog(/Wysłano listę 1 niepewnych/, 20000);
  await app.stop(); await app.waitStopped();
  assert.equal(JSON.parse(await app.ls("ddf_outbox")).length, 0);
  await app.close();
});

// ── F08: pusta odpowiedź z MAX_TOKENS — ponowienie z większym limitem ──
await test("F08 puste MAX_TOKENS jest ponawiane", async () => {
  let phase = 1, n = 0;
  const app = await openApp({ world: { search: () => [A, ...(phase >= 2 ? [B] : [])],
    ai: (b) => { if (b.action) return {}; n++; return n === 1 ? { candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] } : geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 950 })); } } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitLog(/odpowiedź ucięta \(pusta\)/);
  await app.waitUntil(() => genReqs(app.st).length >= 2, 10000, "druga próba");
  const [r1, r2] = genReqs(app.st);
  assert.ok(r2.generationConfig.maxOutputTokens > r1.generationConfig.maxOutputTokens, "większy limit");
  await app.waitLog(/NIE opłaca się/);
  await app.stop(); await app.waitStopped(); await app.close();
});

// ── F09: STOP w trakcie analizy — bez weryfikacji i wysyłki; oferta wraca po starcie ──
await test("F09 STOP przerywa analizę bez wysyłki", async () => {
  let phase = 1, slow = true;
  const app = await openApp({ world: { search: () => [A, ...(phase >= 2 ? [B] : [])],
    ai: (b) => b.action ? {} : { __delay: slow ? 2500 : 0, __json: geminiResp(analysisJson()) } } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitUntil(() => genReqs(app.st).length >= 1, 10000, "start analizy");
  await app.stop(); await app.waitStopped(20000);
  await app.page.waitForTimeout(3000);
  assert.equal(app.st.discord.length, 0, "nic nie wysłano");
  assert.equal(genReqs(app.st).filter(isVer).length, 0, "bez weryfikacji");
  assert.equal(JSON.parse(await app.ls("ddf_pending")).length, 1, "B w kolejce");
  slow = false;
  await app.start();
  await app.waitUntil(() => app.st.discord.length >= 1, 15000, "okazja wysłana po restarcie");
  await app.stop(); await app.waitStopped(); await app.close();
});

// ── F10: zmiana zaznaczonych wyszukiwań w trakcie — działa od następnego cyklu ──
await test("F10 zmiana ustawień działa od następnego cyklu", async () => {
  const app = await openApp({ world: { search: () => [A], ai: defaultAi() } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/);
  await app.page.getByRole("button", { name: "Trek Slash", exact: true }).click();
  await app.page.getByRole("button", { name: "Canyon Torque", exact: true }).click();
  await app.waitUntil(() => (app.st.searchCalls.slash || 0) >= 1, 15000, "pobrano Trek Slash");
  const torqueBefore = app.st.searchCalls.torque;
  await app.waitLog(/Cykl #3 zakończony|Cykl #2 zakończony/);
  await app.stop(); await app.waitStopped();
  assert.ok(app.st.searchCalls.torque <= torqueBefore + 0, "Canyon Torque nie pobierany po zmianie");
  await app.close();
});

// ── F11: spadek dokładnie o 20% (1000 € → 800 €) uruchamia analizę ──
await test("F11 spadek o 20% się liczy", async () => {
  let phase = 1;
  const app = await openApp({ world: { search: () => [phase >= 2 ? { ...A, price: 800 } : A], ai: defaultAi({ decyzja: "nie", szacowana_sprzedaz_eur: 850 }) } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitLog(/Spadek ceny: Canyon Torque AL alt → 800€/);
  await app.waitUntil(() => titlesAnalyzed(app.st).includes(A.title), 10000, "analiza po spadku");
  await app.stop(); await app.waitStopped(); await app.close();
});

// ── F12: nieważny cache Gemini — ponowienie z pełnym promptem ──
await test("F12 nieważny cache → pełny prompt", async () => {
  let phase = 1;
  const app = await openApp({ world: { search: () => [A, ...(phase >= 2 ? [B] : [])],
    ai: (b) => {
      if (b.action === "createCache") return { name: "cachedContents/abc123", usageMetadata: { totalTokenCount: 5000 } };
      if (b.cachedContent) return { __status: 404, __json: { error: { message: "CachedContent not found (or permission denied)" } } };
      return geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 950 }));
    } } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitLog(/cache jest już nieważny/);
  await app.waitLog(/NIE opłaca się/);
  const g = genReqs(app.st);
  assert.ok(g[0].cachedContent && !g[1].cachedContent, "druga próba bez cache");
  assert.ok(promptOf(g[1]).includes("BAZA CEN"), "pełny prompt");
  await app.stop(); await app.waitStopped(); await app.close();
});

// ── F14 + F17: rok widelca nie odrzuca roweru; Neupreis widelca nie obcina wyceny; zysk po transporcie ──
await test("F14/F17 liczby podzespołów nie dotyczą roweru + transport 70 €", async () => {
  let phase = 1;
  const T = L("6000000006", "Canyon Torque AL 2020 L", 700);
  const app = await openApp({ world: {
    search: () => [A, ...(phase >= 2 ? [T] : [])],
    detail: () => ({ desc: "Verkaufe mein Canyon Torque.\nGabel Baujahr 2015, Rahmen Modelljahr 2020.\nNeue Fox 38 Gabel verbaut, Neupreis 1.000 €.\nSRAM GX, Größe L, guter Zustand, kleine Kratzer, regelmäßig gewartet, Rechnung vorhanden. Abholung in Berlin." }),
    ai: defaultAi({ szacowana_sprzedaz_eur: 1400, przewidywany_zysk: 700, fakty: { rocznik: 2020, rocznik_zrodlo: "podany", e_bike: false, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true } }),
  } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitUntil(() => app.st.discord.length >= 1, 15000, "okazja wysłana");
  assert.equal(await app.countLogs(/rocznik 2015/), 0, "brak odrzucenia za rok widelca");
  assert.equal(await app.countLogs(/przycinam/), 0, "brak przycięcia wyceny");
  assert.equal(await app.countLogs(/niespójna matematyka/), 0, "model bez transportu = bez alarmu");
  const zysk = app.st.discord[0].payload.embeds[0].fields.find(f => f.name.includes("zysk")).value;
  assert.equal(zysk, "**~630€** (po transporcie 70€)");
  assert.ok(promptOf(genReqs(app.st)[0]).includes("koszt transportu do Polski 70€"));
  await app.stop(); await app.waitStopped(); await app.close();
});

// ── Reguła 24 h: po przerwie 30 h tylko oferty z ostatnich 24 h; migracja z v5.5 bez stanu wyszukiwań ──
await test("24 h po długiej przerwie + migracja", async () => {
  const now = Date.now();
  const hrefOf = (l) => `https://www.kleinanzeigen.de/s-anzeige/x/${l.id}-217-1234`;
  const seen = [{ id: hrefOf(A), price: 1000, lowest: 1000, notifiedAt: null, type: null }];
  const Bn = { ...B, date: "Heute, 00:01" }, Co = { ...C, date: "01.11.2026" }, Dn = { ...D };
  const app = await openApp({ ls: { ddf_seen: seen, ddf_scan_state: { searches: { canyon_torque: { baselineAt: now - 40 * 3600e3, lastScanAt: now - 30 * 3600e3 } } } },
    world: { search: () => [A, Bn, Co, Dn], ai: defaultAi({ decyzja: "nie", szacowana_sprzedaz_eur: 950 }) } });
  await app.start();
  await app.waitLog(/analizuję 1 ofert z ostatnich 24 h \+ 1 bez daty, pomijam 1 starszych/);
  await app.waitUntil(() => titlesAnalyzed(app.st).includes(B.title), 15000, "B analizowane");
  await app.waitLog(/Cykl #1 zakończony/);
  assert.deepEqual(titlesAnalyzed(app.st).sort(), [B.title, D.title].sort());
  await app.stop(); await app.waitStopped(); await app.close();

  // migracja: jest ddf_seen (v5.5), brak ddf_scan_state → bez "pierwszego skanowania", reguła 24 h
  const app2 = await openApp({ ls: { ddf_seen: seen }, world: { search: () => [A, Bn, Co], ai: defaultAi({ decyzja: "nie", szacowana_sprzedaz_eur: 950 }) } });
  await app2.start();
  await app2.waitUntil(() => titlesAnalyzed(app2.st).includes(B.title), 15000, "B analizowane po migracji");
  assert.equal(await app2.countLogs(/Canyon Torque: pierwsze skanowanie/), 0);
  await app2.stop(); await app2.waitStopped(); await app2.close();
});

// ── Przycisk "Zacznij od zera" ──
await test("Zacznij od zera", async () => {
  const app = await openApp({ ls: { ddf_seen: [{ id: `https://www.kleinanzeigen.de/s-anzeige/x/${A.id}-217-1234`, price: 1000, lowest: 1000 }], ddf_pending: [{ listing: { listingId: B.id, title: B.title, price: 900, href: "https://www.kleinanzeigen.de/s-anzeige/x/" + B.id + "-217-1" }, stage: "analyze", groqType: "full", attempts: 0, addedAt: Date.now() }] },
    world: { search: () => [A, B], ai: defaultAi() } });
  await app.page.getByText("W kolejce do analizy").waitFor();
  app.page.once("dialog", d => d.accept());
  await app.page.getByRole("button", { name: /Zacznij od zera/ }).click();
  await app.waitLog(/Od zera/);
  assert.equal(await app.ls("ddf_seen"), null);
  assert.equal(JSON.parse(await app.ls("ddf_pending")).length, 0);
  assert.deepEqual(JSON.parse(await app.ls("ddf_scan_state")), { searches: {} });
  await app.start();
  await app.waitLog(/Canyon Torque: pierwsze skanowanie tego wyszukiwania — zapamiętano 2/);
  await app.waitLog(/Cykl #1 zakończony/);
  assert.equal(genReqs(app.st).length, 0);
  await app.stop(); await app.waitStopped(); await app.close();
});

// ── F01: czarna lista — całe słowa w tytule; dirt "Singlespeed" przechodzi ──
await test("F01 czarna lista", async () => {
  let phase = 1;
  const ss = L("7000000007", "Singlespeed Dirt Jump Bike NS Zircus", 600, { desc: "DT Swiss Laufradsatz, fahrbereit. Kein Tausch gegen Rennrad." });
  const kid = L("7100000071", "Kinderfahrrad 20 Zoll Puky", 120);
  const frame = L("7200000072", "Canyon Torque Rahmen", 500, { desc: "Verkaufe nur den Rahmen mit Dämpfer" });
  const app = await openApp({ world: { search: () => [A, ...(phase >= 2 ? [ss, kid, frame] : [])], ai: defaultAi({ decyzja: "nie", szacowana_sprzedaz_eur: 620 }) } });
  const unit = await app.page.evaluate(() => ({
    laufrad: keywordRe("laufrad").test("DT Swiss Laufradsatz"), laufrad2: keywordRe("laufrad").test("Laufrad für Kinder"),
    rennrad: keywordRe("rennrad").test("Canyon Torque, kein Tausch"), zoll: keywordRe("20 zoll").test("Kinderfahrrad 20 Zoll"),
    rad: keywordRe("rad").test("Fahrrad"), plural: keywordRe("kinderfahrrad").test("Kinderfahrrads Verkauf"),
    ctxFork: numberContext("Gabel Baujahr 2015", 6), ctxFrame: numberContext("Gabel Baujahr 2015, Rahmen Modelljahr 2020", 27),
  }));
  assert.deepEqual(unit, { laufrad: false, laufrad2: true, rennrad: false, zoll: true, rad: false, plural: true, ctxFork: "component", ctxFrame: "bike" });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitLog(/Filtr: odrzucono \(słowo: "kinderfahrrad"\)/);
  await app.waitLog(/Filtr: odrzucono \(słowo: "nur den Rahmen \(w opisie\)"\)/);
  await app.waitUntil(() => titlesAnalyzed(app.st).includes(ss.title), 15000, "dirt singlespeed analizowany");
  await app.stop(); await app.waitStopped(); await app.close();
});

// ── Claude: zapytania idą do Anthropic z cache bazy cen ──
await test("Claude Haiku jako model analizy i weryfikacji", async () => {
  let phase = 1;
  const app = await openApp({ cfg: { geminiModel: "claude-haiku-5-5", strongModel: "claude-haiku-5-5", claudeKey: "sk-ant-x" },
    world: { search: () => [A, ...(phase >= 2 ? [B] : [])], ai: defaultAi() } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitUntil(() => app.st.discord.length >= 1, 15000, "okazja wysłana");
  const g = genReqs(app.st);
  assert.ok(g.every(b => b.provider === "anthropic" && b.apiKey === "sk-ant-x"));
  assert.ok(g.every(b => b.messages[0].parts[0].cacheControl === true));
  assert.deepEqual(g.map(b => b.generationConfig.claudeEffort), ["medium", "high"]);
  await app.stop(); await app.waitStopped(); await app.close();
});

await closeBrowser();
console.log("\n" + results.map(r => `${r[1] === "OK" ? "✅" : "❌"} ${r[0]}${r[3] ? " — " + r[3] : ""}`).join("\n"));
process.exit(results.some(r => r[1] !== "OK") ? 1 : 0);
