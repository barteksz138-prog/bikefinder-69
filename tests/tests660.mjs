import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.6: Cube sprzed 2020 odrzucany · cena z opisu („Dieses Wochenende 1000€”) · Propain Rage wg zawieszenia w bazie
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque alt", price: 1000 };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
const aiBy = (first, ver = first) => (b) => b.action ? {} : geminiResp(analysisJson(isVer(b) ? ver : first), { imagesAttached: b.imageUrls?.length || 0 });
const run = async (B, world, waitAi = true) => {
  let phase = 1;
  const app = await openApp({ cfg: { profitTiers: [27, 27, 27, 27], transportCostEur: 70 }, world: { detail: () => ({ desc: GOOD, images: 6 }), ...world,
    search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  if (waitAi) await app.waitUntil(() => genReqs(app.st).length >= 1, 20000, "analiza AI");
  else await app.waitLog(/Cykl #2 zakończony/, 30000);
  await app.waitQueueEmpty();
  return app;
};
const resultOf = async (app, id) => {
  for (let i = 0; i < 40; i++) { const a = JSON.parse(await app.ls("ddf_results") || "[]").find(r => r.listing?.listingId === id)?.analysis; if (a) return a; await app.page.waitForTimeout(200); }
  throw new Error(`brak wyniku ${id} w ddf_results`);
};
const FAKTY = (rocznik, zakres) => ({ rocznik, rocznik_zrodlo: "oszacowany", rocznik_zakres: zakres, e_bike: false, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true });

await test("Cube z oszacowanym rocznikiem 2017–2019 → odrzucony (Cube od 2020), prompt podaje próg marki", async () => {
  const B = { id: "2000000661", title: "Cube Stereo HPA 160", price: 450 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 450, szacowana_sprzedaz_eur: 782, przewidywany_zysk: 262, fakty: FAKTY(2017, "2017–2019") }) });
  try {
    assert.ok(promptOf(genReqs(app.st)[0]).includes("Minimalny rocznik dla marki Cube: 2020"), "próg marki w prompcie");
    assert.equal(deals(app.st).length, 0, "bez okazji");
    assert.equal(genReqs(app.st).filter(isVer).length, 0, "bez weryfikacji");
    const a = await resultOf(app, B.id);
    assert.equal(a.odrzucenie, "stary");
    assert.match(a.krotki_opis, /Oszacowany rocznik 2017 \(< 2020 dla Cube\) — odrzucone/);
    assert.ok(await app.countLogs(/NIE opłaca się \(rocznik 2017 sprzed 2020\)/) >= 1, "log z progiem marki");
  } finally { await close(app); }
});

await test("Cube z zakresem 2019–2021 → liczony 2020 i przechodzi; inna marka z rocznikiem 2018 dalej OK", async () => {
  const B = { id: "2000000662", title: "Cube Stereo 150 C:62 Race 29", price: 900 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1400, przewidywany_zysk: 430, fakty: FAKTY(2019, "2019–2021") }) });
  try {
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja");
    assert.ok(await app.countLogs(/zakres 2019–2021 sięga 2020 — liczę 2020/) >= 1);
  } finally { await close(app); }
  const C = { id: "2000000663", title: "Canyon Torque 2018 Fully", price: 900 };
  const app2 = await run(C, { ai: aiBy({ cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1400, przewidywany_zysk: 430, fakty: FAKTY(2018, null) }) });
  try {
    assert.ok(!promptOf(genReqs(app2.st)[0]).includes("Minimalny rocznik dla marki"), "bez progu marki");
    await app2.waitUntil(() => deals(app2.st).length >= 1, 20000, "okazja Canyon 2018");
  } finally { await close(app2); }
});

await test("Cube z rocznikiem 2018 w tytule → odrzucony przed AI", async () => {
  const B = { id: "2000000664", title: "Cube Stereo 140 HPC 2018", price: 900 };
  const app = await run(B, { ai: aiBy({}) }, false);
  try {
    assert.equal(genReqs(app.st).length, 0, "bez AI");
    assert.ok(await app.countLogs(/rok 2018 < 2020 \(Cube\)/) >= 1, "log filtra roku");
  } finally { await close(app); }
});

await test("cena z opisu („Dieses Wochenende 1000€”) → zysk liczony od 1000 €, okazja z polem „🏷️ Cena z opisu”", async () => {
  const B = { id: "2000000665", title: "Canyon Torque CF", price: 1299 };
  const DP = { eur: 1000, warunek: "tylko w ten weekend" };
  const app = await run(B, { detail: () => ({ desc: `${GOOD} Der Preis ist verhandelbar. Dieses Wochenende 1000€`, images: 6 }),
    ai: aiBy({ cena_zakupu_eur: 1299, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 131, decyzja: "tak", cena_z_opisu: DP },
      { cena_zakupu_eur: 1299, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 131, cena_z_opisu: DP }) });
  try {
    assert.ok(promptOf(genReqs(app.st)[0]).includes("=== CENA Z OPISU"), "zasady w prompcie");
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja");
    const e = deals(app.st)[0].payload.embeds[0];
    assert.match(e.fields.find(x => /zysk/i.test(x.name)).value, /~430€/, "1500 − 1000 − 70");
    assert.match(e.fields.find(x => /Cena z opisu/.test(x.name)).value, /\*\*1000€\*\* \(tylko w ten weekend\) — zysk liczony od niej/);
    assert.equal(e.fields.find(x => /Cena z ogłoszenia/.test(x.name)).value, "**1299€**");
    assert.ok(await app.countLogs(/🏷️ Cena z opisu: 1000€ \(tylko w ten weekend\) zamiast 1299€/) >= 1);
  } finally { await close(app); }
});

await test("cena z opisu, której nie ma w tekście → ignorowana, zysk od ceny ogłoszenia", async () => {
  const B = { id: "2000000666", title: "Canyon Torque CF 2", price: 1299 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 1299, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 131, cena_z_opisu: { eur: 1000, warunek: "weekend" } }) });
  try {
    assert.equal(deals(app.st).length, 0);
    assert.ok(await app.countLogs(/podał cenę z opisu 1000€, ale tej kwoty nie ma w opisie/) >= 1);
    const a = await resultOf(app, B.id);
    assert.equal(a.cena_zakupu_eur, 1299); assert.equal(a.cena_z_opisu, null);
  } finally { await close(app); }
});

await test("baza: Propain Rage wg zawieszenia (Fox 40 Factory / Boxxer Ultimate, Fox 40 Performance / Select, World Cup)", async () => {
  const B = { id: "2000000667", title: "Propain Rage DH", price: 1000 };
  const app = await run(B, { ai: aiBy({ cena_zakupu_eur: 1000, szacowana_sprzedaz_eur: 1100, przewidywany_zysk: 30 }) });
  try {
    const p = promptOf(genReqs(app.st)[0]);
    assert.ok(p.includes("Fox 40 Factory (Kashima)") && p.includes("6000–7000 zł"), "wysoka półka");
    assert.ok(p.includes("Boxxer Ultimate, Fox 40 Performance") && p.includes("5700–6300 zł"), "środek");
    assert.ok(p.includes("Boxxer Select / RC, Boxxer World Cup") && p.includes("5000–6000 zł"), "dół");
    assert.ok(!p.includes("6300–7500 zł"), "stare pasmo usunięte");
  } finally { await close(app); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
