import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
// v6.17: wiadomość do sprzedawcy („na granicy”) brzmi jak od zwykłego kupującego — bez „Mein Preisvorschlag berücksichtigt:”,
// najwyżej 2 konkretne rzeczy do zrobienia przy rowerze; rocznik, porównania z rynkiem, ceny i cytaty ze sprzedawcy odpadają
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const blk = src.match(/  const NEGOTIATION_BAD = [\s\S]*?\n  const sendNearToDiscord/);
assert.ok(blk, "blok wiadomości do sprzedawcy w index.html");
const M = new Function(`${blk[0].replace(/\n  const sendNearToDiscord$/, "")}\nreturn { negotiationReasons, sellerMessage };`)();
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }

await test("bez powodów → krótkie pytanie o cenę, odbiór i gotówka", async () => {
  const msg = M.sellerMessage({ offer: 1070 }, null);
  assert.equal(msg, "Hallo,\nist das Fahrrad noch zu haben? Ich hätte Interesse.\nWären 1070 € für Sie in Ordnung?\nIch könnte es kurzfristig abholen und bar bezahlen.\nViele Grüße");
});

await test("powody → jedno naturalne zdanie, najwyżej 2 rzeczy", async () => {
  const msg = M.sellerMessage({ offer: 390 }, "Absenkbare Sattelstütze defekt; Kette rostig; viele Kratzer und Gebrauchsspuren; vergleichbare Stereo 120 werden günstiger angeboten.");
  assert.ok(msg.includes("Es ist allerdings noch etwas zu machen (Absenkbare Sattelstütze defekt, Kette rostig), daher würde ich Ihnen 390 € anbieten."), msg);
  assert.ok(!msg.includes("Preisvorschlag") && !msg.includes("vergleichbar") && !msg.includes("Kratzer"), msg);
});

await test("filtr: rocznik, porównania z rynkiem, ceny, cytaty o cenie i nazwy osprzętu odpadają", async () => {
  assert.deepEqual(M.negotiationReasons("Baujahr ca. 2016-2018; X9 10-fach Antrieb und Kette bald verschlissen; Kratzer am Rahmen; vergleichbare Downhill-Räder werden günstiger angeboten"), ["Kratzer am Rahmen"]);
  assert.deepEqual(M.negotiationReasons("Industrie-Lager in den Laufrädern müssen gewechselt werden; Preis für 750 € bei sofortigem Kauf ist bereits ein Sonderpreis; Dirtbikes dieser Art werden oft für 800 € angeboten"), ["Industrie-Lager in den Laufrädern müssen gewechselt werden"]);
  assert.deepEqual(M.negotiationReasons("- Bremsbeläge fällig.\nKette verschlissen;"), ["Bremsbeläge fällig", "Kette verschlissen"]);
  assert.deepEqual(M.negotiationReasons(null), []);
  // nic sensownego nie zostało → wiadomość bez nawiasu
  assert.ok(M.sellerMessage({ offer: 550 }, "Baujahr 2017; vergleichbare Räder günstiger").includes("Wären 550 € für Sie in Ordnung?"));
});

await test("polecenia AI: nowe zasady argumentów, bez dawnego przykładu z rocznikiem i porównaniem", async () => {
  assert.ok(!src.includes("Preisvorschlag berücksichtigt"));
  assert.ok(!src.includes("Baujahr 2018; Kette und Bremsbeläge bald fällig; vergleichbare Räder"));
  assert.equal((src.match(/"argumenty_negocjacji": "TYLKO gdy decyzja .{0,6}nie.{0,6} z powodu za małego zysku: 1–2 konkretne rzeczy do naprawy \/ wymiany w TYM rowerze/g) || []).length, 2, "oba polecenia (MTB i szosy)");
});

console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
