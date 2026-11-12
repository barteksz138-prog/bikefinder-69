import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v5.15: przednia przerzutka = rower sprzed 2017 (z wyjątkami), nowe wpisy bazy: Trek Remedy 9 alu, Fuel EX 9.8 karbon, Canyon Spectral 125 AL
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${e.message}`); } }

async function firstPrompt(cfg, listing, key) {
  let phase = 1;
  const app = await openApp({ cfg, world: {
    detail: () => ({ desc: "Fully, gepflegt, Fox Gabel, Shimano XT, regelmäßig gewartet, kleine Kratzer. Abholung.", images: 4 }),
    search: (k) => phase === 1 ? (k === "torque" ? [A] : []) : (k === key ? [listing] : []),
    ai: (b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 700 }), { imagesAttached: b.imageUrls?.length || 0 }) } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes(listing.title)), 20000, "analiza AI");
    return promptOf(genReqs(app.st).find(b => promptOf(b).includes(listing.title)));
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
}

await test("Full: zasada „przednia przerzutka = rower stary” z wyjątkami + wpis Remedy 9 alu i Fuel EX 9.8", async () => {
  const p = await firstPrompt({ selectedBikes: ["trek_remedy"] }, { id: "2000000501", title: "Trek Remedy 9 Alu", price: 690 }, "other");
  assert.ok(p.includes("PRZEDNIA PRZERZUTKA = ROWER STARY"), "zasada w KROKU 1");
  assert.ok(p.includes("Trek Fuel EX 9.8 2017–2018 z XT 2x11") && p.includes("bez dowodu w opisie przednia przerzutka = rower sprzed 2017"), "wyjątek dla Fuel EX 9.8 tylko z dowodem w opisie");
  assert.ok(p.includes("przednia przerzutka albo 2–3 zębatki przy korbie w fullu = rower sprzed 2017"), "notka o zdjęciach");
  assert.ok(p.includes("## Trek Remedy 9 — ALU"), "wpis Remedy 9 alu");
  assert.ok(p.includes("Fuel EX 9.8 karbon, 2017–2018"), "wpis Fuel EX 9.8");
  assert.ok(!p.includes("Fuel EX 9.8 karbon Gen 5 (2022+) | POMINIĘTA"), "bez starej luki w bazie");
});

await test("Canyon Spectral 125 AL ma pasmo w bazie", async () => {
  const p = await firstPrompt({}, { id: "2000000502", title: "Canyon Spectral 125 AL 5 Gr. XL", price: 900 }, "torque");
  assert.ok(p.includes("Spectral 125 AL 5 (2022+"), "wpis Spectral 125 AL 5");
  assert.ok(p.includes("Spectral 125 AL 6 (2022+"), "wpis Spectral 125 AL 6");
});

for (const r of results) console.log(r);
await closeBrowser();
if (results.some(r => r.startsWith("❌"))) process.exit(1);
