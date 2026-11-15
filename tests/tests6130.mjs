import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
// v6.13: widelec seryjny (Pike DJ / Bomber DJ) w dirtach z listy DIRT_STOCK_FORKS · „na granicy” bez weryfikacji modelem weryfikacji
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const blk = src.match(/\/\/ ==FORK_START==[\s\S]*?\/\/ ==FORK_END==/);
assert.ok(blk, "blok FORK w index.html");
const F = new Function(`${blk[0]}\nreturn { dirtStockFork, normalizeFork, forkNeedsCheck, fmtFork, DIRT_STOCK_FORKS };`)();
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }

await test("rozpoznanie modelu z widelcem seryjnym (tytuł, opis, tańsze wersje)", async () => {
  const id = (t, d = "") => F.dirtStockFork(t, d)?.id ?? null;
  const cases = [
    ["Rose The Bruce 2 Dirtbike", "bruce2"], ["Rose Bruce 2 Größe M", "bruce2"], ["TheBruce2 Dirt", "bruce2"], ["Rose The Bruce II", "bruce2"],
    ["Rose The Bruce 1 Dirt", null], ["Rose The Bruce 26 Zoll", null], ["Rose The Bruce 2022", null], ["Rose The Bruce Dirtbike", null],
    ["Canyon Stitched 360 Pro", "stitched360pro"], ["Canyon Stitched 360° Pro Dirt", "stitched360pro"], ["Canyon Stitched 360Pro", "stitched360pro"],
    ["Canyon Stitched 360 CLLCTV", "stitched360cllctv"], ["Canyon Stitched 360", null], ["Canyon Stitched 720", null],
    ["Dartmoor Two6player Pro", "two6playerpro"], ["Dartmoor Two6Player-Pro Long", "two6playerpro"], ["Dartmoor Two6player", null],
    ["Commencal Absolut RS", "absolutrs"], ["Commencal Absolut Pike 2025", "absolutrs"], ["Commencal Absolut 2023", null],
    ["Specialized P.3", null], ["Canyon Torque AL 6", null],
  ];
  for (const [t, exp] of cases) assert.equal(id(t), exp, t);
  // z opisu, gdy tytuł nie podaje wersji; tytuł z tańszą wersją wygrywa z opisem
  assert.equal(id("Canyon Stitched Dirtbike", "Verkaufe mein Canyon Stitched 360 Pro in Größe L"), "stitched360pro");
  assert.equal(id("Rose Dirtbike 26 Zoll", "Rose The Bruce 2, kaum gefahren"), "bruce2");
  assert.equal(id("Rose The Bruce 1", "Rahmen wie beim Bruce 2"), null);
  assert.equal(F.dirtStockFork("Rose The Bruce 2", "").src, "tytul");
  assert.equal(F.dirtStockFork("Canyon Stitched", "Stitched 360 Pro").src, "opis");
  assert.equal(F.DIRT_STOCK_FORKS.length, new Set(F.DIRT_STOCK_FORKS.map(m => m.id)).size, "unikalne id");
});

await test("pole widelec: źródło „seryjny” — przyjęty model, ostrzeżenie i etykieta", async () => {
  const w = F.normalizeFork({ model: "RockShox Pike DJ", zrodlo: "seryjny" });
  assert.deepEqual(w, { model: "RockShox Pike DJ", zrodlo: "seryjny", sztywny: false });
  assert.match(F.forkNeedsCheck(w), /przyjęto seryjny: RockShox Pike DJ/);
  assert.equal(F.fmtFork(w), "RockShox Pike DJ (seryjny w tym modelu — przyjęty, sprawdź)");
  // „seryjny” bez modelu = nierozpoznany (jak dotąd)
  assert.deepEqual(F.normalizeFork({ model: "nieznany", zrodlo: "seryjny" }), { model: null, zrodlo: "nieznany", sztywny: false });
  // sama marka z „seryjny” nie jest „bez modelu” (model przyjęty z listy); sama marka z „wyglad” — jak dotąd
  assert.equal(F.normalizeFork({ model: "RockShox", zrodlo: "seryjny" }).bezModelu, undefined);
  assert.equal(F.normalizeFork({ model: "RockShox", zrodlo: "wyglad" }).bezModelu, true);
});

// ── Analiza w aplikacji (atrapy Kleinanzeigen / AI / Discorda) ──
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deal = (st) => st.discord.find(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const nears = (st) => st.discord.filter(d => d.webhookUrl.includes("/3/near"));
const field = (e, s) => e.fields.find(x => x.name.includes(s))?.value;
const NOTE = "WIDELEC SERYJNY TEGO MODELU";
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const NOFORK = "Verkaufe mein Dirtbike, wenig gefahren, Bremsen top, Kette neu, kleine Kratzer am Rahmen, sonst sehr guter Zustand. Abholung in Berlin.";
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
const run = async (B, ai, { desc = NOFORK, cfg = {} } = {}) => {
  let phase = 1;
  const app = await openApp({ cfg: { profitTiers: [27, 27, 27, 27], transportCostEur: 70, ...cfg },
    world: { detail: () => ({ desc, images: 6 }), ai, search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitUntil(() => genReqs(app.st).length >= 1, 20000, "analiza AI");
  await app.waitQueueEmpty();
  await app.page.waitForTimeout(800);
  return app;
};
const aiOf = (o) => (b) => b.action ? {} : geminiResp(analysisJson({ typ_roweru: "dirt", ...o }), { imagesAttached: b.imageUrls?.length || 0 });
const TAK = { cena_zakupu_eur: 600, szacowana_sprzedaz_eur: 900, przewidywany_zysk: 230, decyzja: "tak" };

await test("Bruce 2 bez widelca w opisie → zasada i podpowiedź w prompcie, okazja z widelcem „seryjny”", async () => {
  const B = { id: "2000006121", title: "Rose The Bruce 2 Dirtbike", price: 600 };
  const app = await run(B, aiOf({ ...TAK, widelec: { model: "RockShox Pike DJ", zrodlo: "seryjny", sztywny: false } }));
  try {
    const first = promptOf(genReqs(app.st).find(b => !isVer(b)));
    assert.ok(first.includes("WIDELEC SERYJNY (decyzja właściciela 15.11.2026)"), "zasada w ściądze widelców");
    assert.ok(first.includes("Rose (The) Bruce 2: seryjnie RockShox Pike DJ"), "lista modeli w ściądze");
    assert.ok(first.includes(NOTE) && first.includes("Program rozpoznał w ogłoszeniu model: Rose (The) Bruce 2"), "podpowiedź dla tego ogłoszenia");
    assert.ok(first.includes('"seryjny"'), "źródło „seryjny” w schemacie");
    await app.waitUntil(() => deal(app.st), 15000, "okazja");
    const e = deal(app.st).payload.embeds[0];
    assert.equal(field(e, "Widelec"), "RockShox Pike DJ (seryjny w tym modelu — przyjęty, sprawdź)");
    assert.match(field(e, "Do sprawdzenia") || "", /przyjęto seryjny: RockShox Pike DJ/);
  } finally { await close(app); }
});

await test("Stitched 360 Pro tylko w opisie → podpowiedź; AI zostawia widelec nierozpoznany → ostrzeżenie o seryjnym", async () => {
  const B = { id: "2000006122", title: "Canyon Stitched Dirtbike 26", price: 600 };
  const app = await run(B, aiOf({ ...TAK, widelec: { model: "nieznany", zrodlo: "nieznany", sztywny: false } }),
    { desc: `Verkaufe mein Canyon Stitched 360 Pro, Größe L. ${NOFORK}` });
  try {
    assert.ok(promptOf(genReqs(app.st)[0]).includes("model: Canyon Stitched 360 Pro"));
    await app.waitUntil(() => deal(app.st), 15000, "okazja");
    const warn = field(deal(app.st).payload.embeds[0], "Do sprawdzenia") || "";
    assert.match(warn, /nie rozpoznano/);
    assert.match(warn, /Canyon Stitched 360 Pro ma seryjnie Pike DJ \/ Bomber DJ — wycena mogła przyjąć słabszy/);
  } finally { await close(app); }
});

await test("Bruce 1 i zwykły dirt → bez podpowiedzi o widelcu seryjnym", async () => {
  const B = { id: "2000006123", title: "Rose The Bruce 1 Dirt", price: 600 };
  const app = await run(B, aiOf({ cena_zakupu_eur: 600, szacowana_sprzedaz_eur: 650, przewidywany_zysk: -20, decyzja: "nie" }));
  try {
    const p = promptOf(genReqs(app.st)[0]);
    assert.ok(p.includes("WIDELEC W DIRCIE — JAK ROZPOZNAĆ"), "ściąga dirtowa jest");
    assert.ok(!p.includes(NOTE), "bez podpowiedzi dla Bruce 1");
  } finally { await close(app); }
});

await test("Commencal Absolut RS (bez słowa „dirt”) → ściąga dirtowa i podpowiedź", async () => {
  const B = { id: "2000006124", title: "Commencal Absolut RS", price: 600 };
  const app = await run(B, aiOf({ cena_zakupu_eur: 600, szacowana_sprzedaz_eur: 650, przewidywany_zysk: -20, decyzja: "nie" }));
  try {
    const p = promptOf(genReqs(app.st)[0]);
    assert.ok(p.includes("WIDELEC W DIRCIE — JAK ROZPOZNAĆ") && p.includes("model: Commencal Absolut RS / Absolut Pike"));
  } finally { await close(app); }
});

await test("full z modelem dirta tylko w opisie → bez ściągi dirtowej i bez podpowiedzi, 4 zdjęcia", async () => {
  const B = { id: "2000006126", title: "Canyon Torque AL 6 2021", price: 900 };
  const app = await run(B, aiOf({ typ_roweru: "full", cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 950, przewidywany_zysk: -20, decyzja: "nie" }),
    { desc: `Tausch gegen Canyon Stitched 360 Pro möglich. ${NOFORK}` });
  try {
    const r = genReqs(app.st)[0], p = promptOf(r);
    assert.ok(!p.includes("WIDELEC W DIRCIE — JAK ROZPOZNAĆ") && !p.includes(NOTE));
    assert.equal(r.imageUrls.length, 4);
  } finally { await close(app); }
});

// „na granicy” — tylko model analizy; tuż pod progiem → dokładniejsza analiza TYM SAMYM modelem, alert z jej wyceną
await test("„na granicy” tuż pod progiem → dokładna analiza modelem analizy, bez weryfikacji, alert z jej wyceną", async () => {
  const B = { id: "2000006125", title: "Canyon Torque CF 7", price: 900 };
  // 900 € zakupu, transport 70, próg 27%: zysk 180 € = 20% (7 pp pod progiem → dokładniejsza analiza); druga: 190 € = 21,1%
  let n = 0;
  const ai = (b) => b.action ? {} : geminiResp(analysisJson({ typ_roweru: "full", cena_zakupu_eur: 900, decyzja: "nie",
    ...(isVer(b) ? { szacowana_sprzedaz_eur: 1400, przewidywany_zysk: 430, decyzja: "tak" } : ++n === 1 ? { szacowana_sprzedaz_eur: 1150, przewidywany_zysk: 180 } : { szacowana_sprzedaz_eur: 1160, przewidywany_zysk: 190 }) }),
    { imagesAttached: b.imageUrls?.length || 0 });
  const app = await run(B, ai, { desc: "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer, sonst top. Abholung in Berlin.",
    cfg: { nearWebhook: "https://discord.com/api/webhooks/3/near", strongModel: "gemini-2.5-pro" } });
  try {
    await app.waitUntil(() => nears(app.st).length >= 1, 15000, "alert na granicy");
    const reqs = genReqs(app.st);
    assert.equal(reqs.filter(isVer).length, 0, "bez weryfikacji");
    assert.equal(reqs.length, 2, "pierwsza + dokładna analiza");
    assert.ok(reqs.every(b => b.model === "gemini-2.5-flash"), `tylko model analizy: ${reqs.map(b => b.model).join(", ")}`);
    const e = nears(app.st)[0].payload.embeds[0];
    assert.match(e.fields.find(f => /Szac\. sprzedaż/.test(f.name)).value, /1160€/, "wycena z dokładnej analizy");
    assert.ok(!deal(app.st), "bez okazji");
  } finally { await close(app); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
