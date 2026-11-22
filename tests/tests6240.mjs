import { openApp, closeBrowser, analysisJson, geminiResp, groqResp } from "./harness.mjs";
import handler from "./.build/gem.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
// v6.24 (decyzja właściciela 22.11.2026): DeepSeek — dane z ogłoszenia przed analizą, zastępstwo Groqa w etapie 1,
// wyszukiwanie „Cała kategoria Mountainbikes” (tylko z kluczem DeepSeek; 3 błędy DeepSeeka pod rząd → 20 min przerwy).
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };

// ── blok DS z index.html (czyste funkcje) ──
const HTML = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const repair = HTML.match(/const repairJsonText = [\s\S]*?\n};\n/)[0];
const dsBlock = HTML.match(/\/\/ ==DS_START==[\s\S]*?\/\/ ==DS_END==/)[0];
const consts = HTML.match(/const DEEPSEEK_PRICES[\s\S]*?const searchPageUrl = [^\n]*\n/)[0];
const { parseDsExtract, dsPromptLine, dsExtractPrompt, deepseekCostUsd, searchPageUrl } =
  vm.runInNewContext(`${repair}\n${dsBlock}\n${consts}\n({ parseDsExtract, dsPromptLine, dsExtractPrompt, deepseekCostUsd, searchPageUrl })`, {});

await test("parseDsExtract: poprawny JSON, blok ```json, naprawa i odrzucenie śmieci", async () => {
  const a = parseDsExtract('```json\n{"marka":"Canyon","model":"Torque AL 6","rocznik":2021,"rocznik_zrodlo":"podany","widelec":"Fox 38","kompletny_rower":true,"stan":null,"uszkodzenia":"brak"}\n```');
  assert.deepEqual(JSON.parse(JSON.stringify(a)), { marka: "Canyon", model: "Torque AL 6", widelec: "Fox 38", rocznik: 2021, rocznik_zrodlo: "podany", kompletny_rower: true });
  const b = parseDsExtract('{"marka":"YT","model":"Capra 27,5"" ","rocznik":"2019","rocznik_zrodlo":"zakup",}');
  assert.equal(b.marka, "YT"); assert.equal(b.rocznik, 2019); assert.equal(b.rocznik_zrodlo, "zakup");
  assert.equal(parseDsExtract("nie wiem"), null);
  assert.equal(parseDsExtract("[1,2]"), null);
  assert.equal(parseDsExtract('{"rocznik": 1850}').rocznik, undefined, "nierealny rocznik pominięty");
  assert.equal(parseDsExtract('{"model":"' + "x".repeat(300) + '"}').model.length, 80);
});

await test("dsPromptLine: pusta bez danych, czytelna linia z danymi", async () => {
  assert.equal(dsPromptLine(null), "");
  assert.equal(dsPromptLine({}), "");
  const l = dsPromptLine({ marka: "Canyon", model: "Torque AL 6", rocznik: 2021, rocznik_zrodlo: "zakup", kompletny_rower: false });
  assert.ok(l.startsWith("\nDane wypisane z tekstu ogłoszenia przez inny model"), l);
  assert.ok(l.includes("rocznik: 2021 (rok zakupu)") && l.includes("kompletny rower: NIE") && l.includes("model: Torque AL 6"), l);
  assert.ok(dsExtractPrompt("T", 900, "D").includes("Tytuł: T\nCena: 900 €\nOpis:\nD"));
});

await test("Koszt DeepSeek: poza szczytem i w szczycie (×2), trafienia cache taniej", async () => {
  const u = { prompt_tokens: 2000, prompt_cache_hit_tokens: 1500, prompt_cache_miss_tokens: 500, completion_tokens: 100 };
  const off = deepseekCostUsd(u, new Date("2026-11-22T12:00:00Z")); // niedziela
  const peak = deepseekCostUsd(u, new Date("2026-11-23T07:00:00Z")); // poniedziałek 7:00 UTC
  assert.ok(Math.abs(off - (500 * 0.15 + 1500 * 0.003 + 100 * 0.6) / 1e6) < 1e-12, String(off));
  assert.ok(Math.abs(peak - 2 * off) < 1e-12);
});

await test("Strona N wyników: seite:N przed c217 / k0c217", async () => {
  assert.equal(searchPageUrl("https://www.kleinanzeigen.de/s-fahrraeder/anzeige:angebote/preis:200:1400/c217+fahrraeder.type_s:mountainbike", 2),
    "https://www.kleinanzeigen.de/s-fahrraeder/anzeige:angebote/preis:200:1400/seite:2/c217+fahrraeder.type_s:mountainbike");
  assert.equal(searchPageUrl("https://x/s-fahrraeder/preis:200:1400/dirt/k0c217", 3), "https://x/s-fahrraeder/preis:200:1400/dirt/seite:3/k0c217");
  assert.equal(searchPageUrl("https://x/a/c217", 1), "https://x/a/c217");
});

// ── pośrednik /api/gemini: provider deepseek ──
await test("Pośrednik: DeepSeek — stały adres, myślenie wyłączone, JSON na życzenie, zły model odrzucony", async () => {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }) }; };
  const mkRes = () => { const r = { code: 0, body: null }; r.setHeader = () => {}; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; return r; };
  try {
    let res = mkRes();
    await handler({ method: "POST", body: { provider: "deepseek", model: "deepseek-flash", apiKey: "sk-ds", messages: [{ role: "user", content: "x" }], generationConfig: { maxOutputTokens: 300, json: true } } }, res);
    assert.equal(res.code, 200);
    assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
    assert.equal(calls[0].opts.headers.Authorization, "Bearer sk-ds");
    const b = JSON.parse(calls[0].opts.body);
    assert.deepEqual(b.thinking, { type: "disabled" });
    assert.deepEqual(b.response_format, { type: "json_object" });
    assert.equal(b.max_tokens, 300);
    res = mkRes();
    await handler({ method: "POST", body: { provider: "deepseek", model: "gpt-4o", apiKey: "sk-ds", messages: [] } }, res);
    assert.equal(res.code, 400);
    assert.equal(calls.length, 1, "zły model nie wychodzi na zewnątrz");
  } finally { global.fetch = realFetch; }
});

// ── aplikacja ──
const CAT_RE = /\/c217\+fahrraeder\.type_s:mountainbike/;
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const B = { id: "2000000002", title: "Canyon Torque AL 6 2021 L", price: 900, date: "Heute, 10:00" };
const C = { id: "2000000003", title: "Bulls Copperhead 29 Hardtail", price: 950, date: "Heute, 10:05" };
const D = { id: "2000000004", title: "Canyon Torque AL 5 M", price: 850, date: "Heute, 10:06" };
const GOOD = "Sehr gepflegtes Canyon Torque AL 6, Fox 38 Performance, Float X2, SRAM GX Eagle, Code R Bremsen, Größe L, Rechnung vorhanden. Abholung in Berlin.";
const DS_JSON = JSON.stringify({ marka: "Canyon", model: "Torque AL 6", rocznik: 2021, rocznik_zrodlo: "podany", widelec: "Fox 38 Performance", naped: "SRAM GX Eagle 1x12", kompletny_rower: true });
const dsOk = (content) => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 1200, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 300, completion_tokens: 120 } });
const gemOk = (o = {}) => geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 950, ...o }), { imagesAttached: 0 });
const dsReqs = (st) => st.aiReqs.filter(b => b.provider === "deepseek");
const anReqs = (st) => st.aiReqs.filter(b => b.provider !== "deepseek" && !b.action);

const twoPhase = async ({ cfg, world, newOnes = [B] }, after) => {
  let phase = 1;
  const app = await openApp({ cfg, world: { detail: () => ({ desc: GOOD, images: 2 }), ...world, search: world.search || ((k) => k !== "torque" ? [] : [A, ...(phase >= 2 ? newOnes : [])]) } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app); } finally { await close(app); }
};

await test("Bez klucza DeepSeek: cała kategoria pominięta, analiza bez danych DeepSeeka (polecenie jak przed v6.24)", async () => {
  const urls = [];
  await twoPhase({ cfg: { selectedBikes: ["canyon_torque", "mtb_category"], groqClassifierKey: "gsk_x" },
    world: { search: (k, n, st, url) => { urls.push(url); return k !== "torque" ? [] : [A, ...(n >= 2 ? [B] : [])]; }, ai: (b) => b.action ? {} : gemOk() } }, async (app) => {
    await app.waitLog(/Cała kategoria Mountainbikes pominięta w tym cyklu \(brak klucza DeepSeek\)/);
    await app.waitLog(/etap 2\): analizuję/, 20000);
    await app.waitQueueEmpty();
    assert.equal(urls.filter(u => CAT_RE.test(u)).length, 0, "kategoria nie była odpytywana");
    assert.equal(dsReqs(app.st).length, 0);
    assert.ok(!promptOf(anReqs(app.st)[0]).includes("Dane wypisane z tekstu ogłoszenia"));
  });
});

await test("Z kluczem: DeepSeek wypisuje dane przed analizą, analiza dostaje je w poleceniu, koszt w etapie „deepseek dane”", async () => {
  await twoPhase({ cfg: { deepseekKey: "sk-ds", groqClassifierKey: "gsk_x" },
    world: { ai: (b) => b.provider === "deepseek" ? dsOk(DS_JSON) : b.action ? {} : gemOk() } }, async (app) => {
    await app.waitLog(/🐳 DeepSeek .*dane z ogłoszenia — Canyon · Torque AL 6 · 2021 · Fox 38 Performance/, 20000);
    await app.waitQueueEmpty();
    const ds = dsReqs(app.st);
    assert.equal(ds.length, 1, "jedno zapytanie DeepSeek (Groq działa — bez zastępstwa)");
    assert.equal(ds[0].model, "deepseek-flash");
    assert.equal(ds[0].generationConfig.json, true);
    assert.ok(promptOf(ds[0]).includes("Tytuł: Canyon Torque AL 6 2021 L") && promptOf(ds[0]).includes("Fox 38 Performance"));
    const p = promptOf(anReqs(app.st)[0]);
    assert.ok(p.includes("Dane wypisane z tekstu ogłoszenia przez inny model") && p.includes("napęd: SRAM GX Eagle 1x12"), p.slice(-1500));
    const spend = JSON.parse(await app.ls("ddf_ai_spend"));
    assert.ok(spend.byStage["deepseek dane"]?.calls === 1, JSON.stringify(spend.byStage));
  });
});

await test("Groq niedostępny → etap 1 robi DeepSeek tym samym poleceniem; „inny” odrzuca bez analizy", async () => {
  await twoPhase({ cfg: { deepseekKey: "sk-ds", groqClassifierKey: "gsk_x" }, newOnes: [B, C],
    world: {
      groq: () => ({ error: { message: "Service unavailable" } }),
      ai: (b) => {
        if (b.provider !== "deepseek") return b.action ? {} : gemOk();
        const p = promptOf(b);
        if (p.startsWith("Klasyfikator ogłoszeń rowerowych")) return dsOk(`uzasadnienie\n${p.includes("Tytuł: Bulls Copperhead") ? "inny" : "full"}`);
        return dsOk(DS_JSON);
      } } }, async (app) => {
    await app.waitLog(/DeepSeek za Groqa .*typ="full".*Torque AL 6/, 20000);
    await app.waitLog(/DeepSeek za Groqa .*typ="inny".*Copperhead/, 20000);
    await app.waitQueueEmpty();
    const cls = dsReqs(app.st).filter(b => promptOf(b).startsWith("Klasyfikator ogłoszeń rowerowych"));
    assert.equal(cls.length, 2);
    assert.ok(promptOf(cls[0]).includes("ROK PRODUKCJI") && cls[0].generationConfig.maxOutputTokens === 300);
    assert.equal(anReqs(app.st).length, 1, "tylko „full” poszedł do analizy");
    assert.ok(!(await app.text()).match(/Uncaught|TypeError/));
  });
});

await test("Bez klucza Groq, z kluczem DeepSeek → DeepSeek klasyfikuje", async () => {
  await twoPhase({ cfg: { deepseekKey: "sk-ds" },
    world: { ai: (b) => b.provider === "deepseek" ? (promptOf(b).startsWith("Klasyfikator") ? dsOk("x\nfull") : dsOk(DS_JSON)) : b.action ? {} : gemOk() } }, async (app) => {
    await app.waitLog(/DeepSeek za Groqa .*typ="full"/, 20000);
    await app.waitQueueEmpty();
    assert.equal(app.st.groqReqs.length, 0);
  });
});

await test("3 błędy DeepSeeka pod rząd → 20 min przerwy: kategoria pominięta, analizy idą dalej bez danych, komunikat na kanał problemów", async () => {
  const urls = [];
  let phase = 1, dsCalls = 0, paused = false;
  const app = await openApp({ cfg: { deepseekKey: "sk-ds", groqClassifierKey: "gsk_x", selectedBikes: ["canyon_torque", "mtb_category"], statusWebhook: "https://discord.com/api/webhooks/4/status" },
    world: {
      detail: () => ({ desc: GOOD, images: 2 }),
      search: (k, n, st, url) => { urls.push({ url, phase, paused }); return k !== "torque" ? [] : [A, ...(phase >= 2 ? [B, C, D] : [])]; },
      ai: (b) => {
        if (b.provider !== "deepseek") return b.action ? {} : gemOk();
        if (++dsCalls >= 3) paused = true;
        return { __status: 503, __json: { error: { message: "Server busy" } } };
      },
    } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    assert.ok(urls.some(u => u.phase === 1 && CAT_RE.test(u.url)), "w cyklu 1 kategoria skanowana (klucz jest)");
    await app.waitLog(/⛔ DeepSeek: 3 błędy pod rząd/, 30000);
    await app.waitQueueEmpty(30000);
    assert.equal(dsCalls, 3, "po przerwie bez kolejnych zapytań do DeepSeeka");
    assert.equal(anReqs(app.st).length, 3, "wszystkie 3 oferty przeanalizowane mimo błędów DeepSeeka");
    await app.waitLog(/Cała kategoria Mountainbikes pominięta w tym cyklu \(przerwa po błędach DeepSeeka/, 30000);
    const n0 = urls.filter(u => u.paused).length;
    await app.waitUntil(async () => urls.filter(u => u.paused).length > n0 + 1, 30000, "kolejne wyszukiwania po przerwie");
    const after = urls.filter(u => u.paused);
    assert.ok(!after.some(u => CAT_RE.test(u.url)), "po przerwie tylko zwykłe wyszukiwania: " + after.map(u => u.url).join(" | "));
    await app.waitUntil(async () => app.st.discord.some(d => /DeepSeek nie odpowiada/.test(JSON.stringify(d))), 15000, "komunikat na kanał problemów");
  } finally { await close(app); }
});

await test("Cała kategoria: link z typem MTB i zakresem cen; cała nowa strona → dobiera stronę 2", async () => {
  const mk = (from, n) => Array.from({ length: n }, (_, i) => ({ id: String(3000000000 + from + i), title: `Mountainbike Hardtail ${from + i}`, price: 300 + i, date: "Heute, 11:00" }));
  const urls = [];
  let phase = 1;
  const app = await openApp({ cfg: { deepseekKey: "sk-ds", groqClassifierKey: "gsk_x", selectedBikes: ["mtb_category"] },
    world: {
      groq: () => groqResp("inny"),
      search: (k, n, st, url) => { urls.push(url); if (!CAT_RE.test(url)) return []; if (phase === 1) return mk(0, 25); return url.includes("/seite:2/") ? [...mk(50, 10), ...mk(0, 15)] : mk(25, 25); },
      ai: (b) => b.provider === "deepseek" ? dsOk(DS_JSON) : b.action ? {} : gemOk(),
    } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/);
    const first = urls.find(u => CAT_RE.test(u));
    assert.equal(first, "https://www.kleinanzeigen.de/s-fahrraeder/anzeige:angebote/preis:200:1400/c217+fahrraeder.type_s:mountainbike");
    assert.ok(!urls.some(u => u.includes("seite:")), "pierwszy skan (zapamiętanie) bez kolejnych stron");
    phase = 2;
    await app.waitLog(/cała strona 1 nowa — dobieram stronę 2 \(25 ogłoszeń\)/, 30000);
    await app.waitLog(/Cykl #2 zakończony/, 60000);
    assert.ok(urls.includes("https://www.kleinanzeigen.de/s-fahrraeder/anzeige:angebote/preis:200:1400/seite:2/c217+fahrraeder.type_s:mountainbike"));
    assert.ok(!urls.some(u => u.includes("seite:3")), "strona 2 miała już znane ogłoszenia — bez strony 3");
    await app.waitLog(/Cała kategoria Mountainbikes \(wymaga DeepSeek\): 35 nowych ogłoszeń/, 30000);
  } finally { await close(app); }
});

await closeBrowser();
for (const r of results) console.log(r);
if (results.some(r => r.startsWith("❌"))) process.exit(1);
