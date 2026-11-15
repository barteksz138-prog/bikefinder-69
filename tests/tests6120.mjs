import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.12: baza — Ghost E-Riot Essential ma osobne, niższe pasmo (7000–8500 zł); pozostałe wersje E-Riot / E-ASX bez zmian
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const GOOD = "Sehr gepflegtes E-Bike, Bosch CX, 625 Wh Akku, Ladegerät dabei, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer, sonst top. Abholung.";
const A = { id: "1000000001", title: "Canyon Torque alt", price: 1000 };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };

await test("Ghost E-Riot Essential: w prompcie osobne pasmo 7000–8500 zł, wycena 1600 € przy 1050 € nadal daje okazję", async () => {
  let phase = 1;
  const B = { id: "2000000712", title: "E-Bike Ghost E-Riot Trail Essential 2022 Gr. S", price: 1050 };
  // 1050 € zakupu, próg 30%: okazja od sprzedaży 1435 €; 1600 € (dół nowego pasma) → zysk 480 €
  const ans = { typ_roweru: "elektryk_gorski", cena_zakupu_eur: 1050, szacowana_sprzedaz_eur: 1600, przewidywany_zysk: 480, decyzja: "tak",
    fakty: { rocznik: 2022, rocznik_zrodlo: "podany", rocznik_zakres: null, e_bike: true, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true } };
  const app = await openApp({ cfg: { profitTiers: [65, 40, 30, 27], transportCostEur: 70, excludeElektryk: false }, world: { detail: () => ({ desc: GOOD, images: 6 }),
    ai: (b) => b.action ? {} : geminiResp(analysisJson(ans), { imagesAttached: b.imageUrls?.length || 0 }),
    search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitUntil(() => genReqs(app.st).length >= 1, 20000, "analiza AI");
    const p = promptOf(genReqs(app.st)[0]);
    assert.ok(p.includes("E-Riot Essential (2021–2023; Trail / AM / EN)") && p.includes("sprzedaż PL 7000–8500 zł (≈1610–1950 €)"), "pasmo Essential w prompcie");
    assert.ok(p.includes("E-Riot pozostałe wersje (Advanced, Pro, Full Party, CF) / E-ASX (2021–2023)") && p.includes("sprzedaż PL 8000–9800 zł (≈1840–2250 €)"), "pasmo pozostałych wersji bez zmian");
    assert.ok(!p.includes("- E-Riot / E-ASX (2021–2023)"), "stary wspólny wiersz usunięty");
    await app.waitUntil(() => deals(app.st).length >= 1, 30000, "okazja");
    assert.match(deals(app.st)[0].payload.embeds[0].fields.find(f => /zysk/i.test(f.name)).value, /480€/);
  } finally { await close(app); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
