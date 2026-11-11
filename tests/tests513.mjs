import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v5.13: ściąga widelców w dirtach, pole "widelec", sztywny widelec → odrzucenie, wszystkie zdjęcia przy dirtach, „📷 Zdjęcia” w „na granicy”
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const GUIDE = "WIDELEC W DIRCIE — JAK ROZPOZNAĆ";
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const NEAR_HOOK = "https://discord.com/api/webhooks/3/near";
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${e.message}`); } }
const twoPhase = async (opts, after) => {
  let phase = 1;
  const app = await openApp({ ...opts, world: { detail: () => ({ desc: GOOD, images: 8 }), ...opts.world, search: (k) => k !== "torque" ? [] : [A, ...(phase >= 2 ? opts.newOnes : [])] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
};
const ai = (o = {}) => (b) => b.action ? {} : geminiResp(analysisJson(o), { imagesAttached: b.imageUrls?.length || 0 });
const DIRT = { typ_roweru: "dirt", cena_zakupu_eur: 600, szacowana_sprzedaz_eur: 1100 };
const deal = (st) => st.discord.find(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const field = (e, s) => e.fields.find(x => x.name.includes(s))?.value;

await test("Dirt: ściąga widelców w prompcie i od razu wszystkie zdjęcia (8)", async () => {
  const B = { id: "2000000101", title: "Rose The Bruce 2 Dirtbike", price: 600 };
  await twoPhase({ newOnes: [B], world: { ai: ai({ ...DIRT, decyzja: "nie", szacowana_sprzedaz_eur: 700 }) } }, async (app) => {
    await app.waitUntil(() => genReqs(app.st).length >= 1, 15000, "analiza AI");
    const r = genReqs(app.st)[0];
    assert.ok(promptOf(r).includes(GUIDE), "brak ściągi w prompcie dirta");
    assert.equal(r.imageUrls.length, 8);
    assert.ok(promptOf(r).includes('"widelec"'), "brak pola widelec w schemacie");
  });
});

await test("Full: bez ściągi dirtowej, 4 zdjęcia, ale z zasadą o Kashimie", async () => {
  const B = { id: "2000000102", title: "Canyon Torque AL 6 2021", price: 900 };
  await twoPhase({ newOnes: [B], world: { ai: ai({ decyzja: "nie", szacowana_sprzedaz_eur: 950 }) } }, async (app) => {
    await app.waitUntil(() => genReqs(app.st).length >= 1, 15000, "analiza AI");
    const r = genReqs(app.st)[0];
    assert.ok(!promptOf(r).includes(GUIDE), "ściąga dirtowa nie powinna trafić do fulla");
    assert.equal(r.imageUrls.length, 4);
    assert.ok(promptOf(r).includes("Złote lagi Kashima mają WYŁĄCZNIE widelce Fox"));
    assert.ok(!promptOf(r).includes("złote goleni Kashima = Fox Factory"), "stara reguła o Kashimie");
  });
});

await test("Dirt ze sztywnym widelcem → odrzucony mimo zysku, bez alertu", async () => {
  const B = { id: "2000000103", title: "Dartmoor Gamer Dirtbike", price: 300 };
  await twoPhase({ newOnes: [B], world: { ai: ai({ ...DIRT, cena_zakupu_eur: 300, szacowana_sprzedaz_eur: 900, widelec: { model: "sztywny widelec", zrodlo: "wyglad", sztywny: true } }) } }, async (app) => {
    await app.waitLog(/NIE opłaca się \(sztywny widelec/);
    await app.waitLog(/Cykl #2 zakończony/);
    assert.ok(!deal(app.st), "nie powinno być okazji");
    assert.equal(genReqs(app.st).filter(isVer).length, 0, "bez weryfikacji");
  });
});

await test("Okazja na dircie: pole „Widelec” i ostrzeżenie, gdy widelec rozpoznany tylko z wyglądu", async () => {
  const B = { id: "2000000104", title: "Rose The Bruce 1 Dirt", price: 600 };
  await twoPhase({ newOnes: [B], world: { ai: ai({ ...DIRT, widelec: { model: "RockShox Pike DJ", zrodlo: "wyglad", sztywny: false } }) } }, async (app) => {
    await app.waitUntil(() => deal(app.st), 20000, "okazja");
    const e = deal(app.st).payload.embeds[0];
    assert.equal(field(e, "Widelec"), "RockShox Pike DJ (z wyglądu — sprawdź)");
    assert.ok(/sprawdź widelec/.test(field(e, "Do sprawdzenia") || ""), JSON.stringify(e.fields));
  });
});

await test("Dirt bez rozpoznanego widelca → „nie rozpoznano” w alercie i ostrzeżenie", async () => {
  const B = { id: "2000000105", title: "Specialized P.3 Dirt", price: 600 };
  await twoPhase({ newOnes: [B], world: { ai: ai({ ...DIRT, widelec: { model: "nieznany", zrodlo: "nieznany", sztywny: false } }) } }, async (app) => {
    await app.waitUntil(() => deal(app.st), 20000, "okazja");
    const e = deal(app.st).payload.embeds[0];
    assert.equal(field(e, "Widelec"), "nie rozpoznano");
    assert.ok(/nie rozpoznano/.test(field(e, "Do sprawdzenia") || ""));
  });
});

await test("Widelec z napisu na fullu → pole w alercie, bez ostrzeżenia o widelcu", async () => {
  const B = { id: "2000000106", title: "Canyon Torque AL 7", price: 900 };
  await twoPhase({ newOnes: [B], world: { ai: ai({ widelec: { model: "Fox 38 Performance Elite", zrodlo: "napis", sztywny: false } }) } }, async (app) => {
    await app.waitUntil(() => deal(app.st), 20000, "okazja");
    const e = deal(app.st).payload.embeds[0];
    assert.equal(field(e, "Widelec"), "Fox 38 Performance Elite (napis na zdjęciu)");
    assert.ok(!/widel/.test(field(e, "Do sprawdzenia") || ""));
  });
});

await test("AI rozpoznało dirta w fullowym tytule → weryfikacja już ze ściągą", async () => {
  const B = { id: "2000000107", title: "Canyon Torque Custom Aufbau", price: 600 };
  await twoPhase({ newOnes: [B], world: { ai: ai({ ...DIRT }) } }, async (app) => {
    await app.waitUntil(() => deal(app.st), 20000, "okazja");
    const reqs = genReqs(app.st).filter(r => promptOf(r).includes("Canyon Torque Custom Aufbau"));
    assert.ok(!promptOf(reqs[0]).includes(GUIDE), "pierwsza analiza bez ściągi");
    assert.ok(reqs.some(r => isVer(r) && promptOf(r).includes(GUIDE)), "weryfikacja ze ściągą");
    await app.waitLog(/Rozpoznano dirta/);
  });
});

await test("„Na granicy”: wraca pole „📷 Zdjęcia”", async () => {
  const B = { id: "2000000108", title: "Canyon Torque CF 7", price: 1000 };
  await twoPhase({ newOnes: [B], cfg: { nearWebhook: NEAR_HOOK }, world: { ai: ai({ decyzja: "nie", cena_zakupu_eur: 1000, szacowana_sprzedaz_eur: 1150, zdjecia: "Rama karbon, Fox 36" }) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.some(d => d.webhookUrl === NEAR_HOOK), 20000, "na granicy");
    const e = app.st.discord.find(d => d.webhookUrl === NEAR_HOOK).payload.embeds[0];
    assert.equal(field(e, "Zdjęcia"), "Rama karbon, Fox 36");
  });
});

await closeBrowser();
console.log(results.join("\n"));
process.exit(results.some(r => r.startsWith("❌")) ? 1 : 0);
