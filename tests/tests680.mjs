import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.8: ściąga generacji dla 30 modeli (partie 1–2) i kolory — tylko dla weryfikatora
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const nears = (st) => st.discord.filter(d => d.webhookUrl.includes("/3/near"));
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque alt", price: 1000 };
const NEAR = "https://discord.com/api/webhooks/3/near";
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
const aiBy = (first, ver = first) => (b) => b.action ? {} : geminiResp(analysisJson(isVer(b) ? ver : first), { imagesAttached: b.imageUrls?.length || 0 });
const run = async (B, world, cfg = {}) => {
  let phase = 1;
  const app = await openApp({ cfg: { profitTiers: [27, 27, 27, 27], transportCostEur: 70, ...cfg }, world: { detail: () => ({ desc: GOOD, images: 6 }), ...world,
    search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitUntil(() => genReqs(app.st).length >= 1, 20000, "analiza AI");
  await app.waitQueueEmpty();
  await app.page.waitForTimeout(800);
  return app;
};
// 900 € zakupu, próg 27%: okazja od sprzedaży 1213 € (900 + 70 + 243); „na granicy” — cena musi spaść najwyżej o 20%
const NO_NEAR = { cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1100, przewidywany_zysk: 130, decyzja: "nie" };

await test("Canyon Neuron: weryfikator dostaje nową ściągę z kolorami, Haiku nie", async () => {
  const B = { id: "2000000681", title: "Canyon Neuron CF 8.0 Größe L", price: 900 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1400, przewidywany_zysk: 430, decyzja: "tak" }) });
  try {
    const reqs = genReqs(app.st), first = promptOf(reqs.find(b => !isVer(b))), ver = promptOf(reqs.find(isVer));
    assert.ok(!first.includes("ŚCIĄGA GENERACJI"), "Haiku bez ściągi");
    assert.ok(ver.includes("ŚCIĄGA GENERACJI — Canyon Neuron"), "ściąga Neurona");
    assert.ok(ver.includes("POZIOMO pod rurą górną") && ver.includes("Kolory (pomocniczo)") && ver.includes("Matcha Green"), "treść i kolory");
    assert.ok(!ver.includes("ŚCIĄGA GENERACJI — Canyon Torque"), "nie ściąga z nazwy wyszukiwania");
  } finally { await close(app); }
});

await test("Trek Slash: stara ściąga ma teraz kolory", async () => {
  const B = { id: "2000000682", title: "Trek Slash 8 29", price: 900 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1400, przewidywany_zysk: 430, decyzja: "tak" }) });
  try {
    const ver = promptOf(genReqs(app.st).find(isVer));
    assert.ok(ver.includes("ŚCIĄGA GENERACJI — Trek Slash") && ver.includes("Lithium Grey") && ver.includes("Straight Shot"));
  } finally { await close(app); }
});

// e-bike (Neuron:ON, Fuel EX-e, E-Riot…) — bez ściągi: sprawdza t_gensheet.mjs

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
