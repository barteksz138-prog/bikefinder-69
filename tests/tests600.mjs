import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6: minimalny zysk (%) zależny od ceny zakupu — przedziały 200–450, 450–800, 800–1100, 1100–1400 €
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n");
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const NEAR = "https://discord.com/api/webhooks/3/near";
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${e.message}`); } }
const TIERS = [60, 40, 30, 20];

async function run(cfg, listing, aiOverrides, after) {
  let phase = 1;
  const app = await openApp({ cfg: { profitTiers: TIERS, ...cfg }, world: {
    detail: () => ({ desc: "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer. Abholung.", images: 4 }),
    search: (k) => k !== "torque" ? [] : [A, ...(phase >= 2 ? [listing] : [])],
    ai: (b) => b.action ? {} : geminiResp(analysisJson({ cena_zakupu_eur: listing.price, ...aiOverrides }), { imagesAttached: b.imageUrls?.length || 0 }) } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
}

await test("Tania oferta (400 €, próg 60%): zysk 45% → nie; prompt podaje próg dla tej ceny", async () => {
  // zysk = 650 − 400 − 70 = 180 € = 45%
  await run({}, { id: "2000000601", title: "Canyon Torque AL 400", price: 400 }, { decyzja: "tak", szacowana_sprzedaz_eur: 650 }, async (app) => {
    await app.waitLog(/zysk to tylko 45\.0% \(próg 60%\)/);
    const p = promptOf(genReqs(app.st)[0]);
    assert.ok(p.includes("Minimalny zysk dla tej ceny zakupu: 60% ceny zakupu"), "próg w części dynamicznej");
    assert.ok(p.includes("200–450 € → 60%, 450–800 € → 40%, 800–1100 € → 30%, 1100–1400 € → 20%"), "wszystkie progi");
    assert.ok(!promptOf(genReqs(app.st)[0]).split("=== OGŁOSZENIE DO OCENY ===")[0].includes("Minimalny zysk dla tej ceny"), "część stała bez liczb progu (cache)");
    await app.waitLog(/Cykl #2 zakończony/);
    assert.equal(deals(app.st).length, 0);
  });
});

await test("Droga oferta (1200 €, próg 20%): zysk 23% → okazja", async () => {
  // zysk = 1550 − 1200 − 70 = 280 € ≈ 23,3%
  await run({}, { id: "2000000602", title: "Canyon Torque CF 1200", price: 1200 }, { decyzja: "tak", szacowana_sprzedaz_eur: 1550 }, async (app) => {
    await app.waitUntil(() => deals(app.st).length, 20000, "okazja");
    assert.ok(genReqs(app.st).some(isVer));
  });
});

await test("Granica przedziału: 450 € liczy się do 450–800 € (próg 40%)", async () => {
  // zysk = 720 − 450 − 70 = 200 € ≈ 44,4% — przy progu 60% byłoby „nie”
  await run({}, { id: "2000000603", title: "Canyon Torque AL 450", price: 450 }, { decyzja: "tak", szacowana_sprzedaz_eur: 720 }, async (app) => {
    await app.waitUntil(() => deals(app.st).length, 20000, "okazja przy progu 40%");
  });
});

await test("„Opłaca się do” liczone z progami przedziałów", async () => {
  // sprzedaż 900, transport 70: przedział 450–800 (40%) → floor(830 / 1,4) = 592; 800–1100 (30%) → 638 < 800, nie pasuje
  await run({ nearWebhook: NEAR }, { id: "2000000604", title: "Canyon Torque AL 650", price: 650 }, { decyzja: "nie", szacowana_sprzedaz_eur: 900 }, async (app) => {
    await app.waitLog(/opłaca się do 592€/);
    const near = app.st.discord.find(d => d.webhookUrl === NEAR);
    assert.ok(near, "alert na granicy");
    assert.equal(near.payload.embeds[0].fields.find(f => f.name.includes("Opłaca się do")).value, "**592€**");
  });
});

await test("Stare ustawienia (jeden minProfit) → wszystkie progi = minProfit", async () => {
  let phase = 1;
  const B = { id: "2000000605", title: "Canyon Torque AL 300", price: 300 };
  const app = await openApp({ cfg: { minProfit: 35 }, world: {
    search: (k) => k !== "torque" ? [] : [A, ...(phase >= 2 ? [B] : [])],
    ai: (b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", cena_zakupu_eur: 300, szacowana_sprzedaz_eur: 400 }), { imagesAttached: b.imageUrls?.length || 0 }) } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitUntil(() => genReqs(app.st).length >= 1, 15000, "analiza");
    assert.ok(promptOf(genReqs(app.st)[0]).includes("200–450 € → 35%, 450–800 € → 35%, 800–1100 € → 35%, 1100–1400 € → 35%"));
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

for (const r of results) console.log(r);
await closeBrowser();
if (results.some(r => r.startsWith("❌"))) process.exit(1);
