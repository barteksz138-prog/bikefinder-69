import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n");
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const B = { id: "2000000002", title: "Canyon Torque CF 9 2022", price: 450 };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${e.message}`); } }
await test("Podejrzanie tania okazja → OKAZJA z ostrzeżeniem (nie niepewne)", async () => {
  let phase = 1;
  const app = await openApp({ world: { search: () => [A, ...(phase >= 2 ? [B] : [])], detail: () => ({ desc: "Fast neu, top Zustand, nur Abholung, Fox 38 Factory, XX1 AXS.", images: 3 }),
    ai: (b) => b.action ? {} : geminiResp(analysisJson({ szacowana_sprzedaz_eur: 2500, ostrzezenia: "cena podejrzanie niska, zdjęcia wyglądają na katalogowe" }), { imagesAttached: b.imageUrls?.length || 0 }) } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitUntil(() => app.st.discord.length >= 1, 15000, "okazja");
  const e = app.st.discord[0].payload.embeds[0];
  assert.equal(e.fields.find(f => f.name.includes("Do sprawdzenia")).value, "cena podejrzanie niska, zdjęcia wyglądają na katalogowe");
  const p = promptOf(app.st.aiReqs.find(b => !b.action));
  assert.ok(p.includes("PODEJRZANIE NISKA CENA, MOŻLIWE OSZUSTWO, UKRYTE WADY — to NIE jest powód"));
  assert.ok(!p.includes("sygnał oszustwa → \"niepewne\""));
  assert.ok(!p.includes('"mozliwe_uszkodzenia"'));
  await app.stop(); await app.waitStopped(); await app.close();
});
await closeBrowser();
console.log(results.join("\n"));
process.exit(results.some(r => r.startsWith("❌")) ? 1 : 0);
