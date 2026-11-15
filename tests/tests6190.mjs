import { openApp, closeBrowser, analysisJson, geminiResp, groqResp } from "./harness.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
// v6.19: ŚCIĄGA WIDELCÓW (napisy, naklejki, kształt goleni) w stałej części polecenia MTB — używana tylko przy czytelnym
// napisie albo wyraźnej cesze; starszy widelec niż rocznik z ogłoszenia + opis niezgodny ze zdjęciami → rocznik „oszacowany”
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const m = src.match(/const FORK_SHEET = (`[\s\S]*?`);\n/);
assert.ok(m, "FORK_SHEET w index.html");
const SHEET = new Function(`return ${m[1]};`)();
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }

await test("treść ściągi: zasada pewności, kolor to nie dowód, daty RockShox i Fox, wpływ na rocznik", async () => {
  for (const t of [
    "TYLKO wtedy, gdy na zdjęciu naprawdę to widzisz: CZYTELNY napis",
    "napis na widelcu nieczytelny",
    "Markę ustalaj z NAPISU",
    "Sam kolor naklejek mało znaczy",
    "GÓRNA granica rocznika roweru",
    "RC / RCT3 / RC2 (często z napisem „Charger 2”) = do MY2019. Select / Select+ / Ultimate = od MY2020.",
    "„Charger 3” albo „ButterCups” = od MY2023",
    "Select = czarne golenie z CZARNYMI",
    "ZEB (lagi 38 mm",
    "„GRIP2” = od MY2019",
    "„CTD” = MY2013–2015",
    "Fox 36 Rhythm jeszcze do ok. MY2023 miał stary odlew BEZ przycisków",
    "opis niezgodny ze zdjęciami",
    "\"rocznik_zrodlo\": \"oszacowany\"",
  ]) assert.ok(SHEET.includes(t), `ściąga: ${t}`);
  assert.ok(!SHEET.includes("`") && !SHEET.includes("${"), "czysty tekst");
});

await test("polecenie MTB: ściąga po części ogólnej bazy; zdjęcia i widelec odsyłają do niej; czarne lagi już nie = Fox", async () => {
  assert.ok(src.includes("${KB.core}\n\n${FORK_SHEET}\n\n=== KONIEC CZĘŚCI OGÓLNEJ BAZY ==="));
  assert.ok(!src.includes("czarne = Rhythm / Performance / Performance Elite"), "stara wskazówka o czarnych lagach usunięta");
  assert.ok(src.includes("czarne lagi mają i Foxy Rhythm / Performance / Performance Elite, i prawie wszystkie RockShoxy"));
  assert.ok(src.includes("Gdy CZYTELNY napis na zdjęciu przeczy opisowi — wygrywa napis") && src.includes("Sam kolor lag albo naklejek to nie dowód niezgodności."));
  const road = src.match(/\/\/ ==ROAD_START==[\s\S]*?\/\/ ==ROAD_END==/)[0];
  assert.ok(!road.includes("FORK_SHEET"), "tor szos bez ściągi widelców");
});

const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
await test("aplikacja: analiza MTB dostaje ściągę w poleceniu", async () => {
  const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
  const B = { id: "2000006191", title: "Trek Slash 8 2022 Mountainbike", price: 1230 };
  let phase = 1;
  const app = await openApp({ cfg: { profitTiers: [27, 27, 27, 27], transportCostEur: 70, groqClassifierKey: "gsk_test" },
    world: { detail: () => ({ desc: "Trek Slash 8, Fox 36 Rhythm, Alpha Platinum Aluminium, 19.5 Zoll", images: 3 }),
      ai: (b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 900, przewidywany_zysk: -400 })),
      groq: () => groqResp("full"),
      search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitUntil(() => app.st.aiReqs.some(b => !b.action), 20000, "analiza AI");
    const p = promptOf(app.st.aiReqs.find(b => !b.action));
    assert.ok(p.includes("=== ŚCIĄGA WIDELCÓW — NAPISY, NAKLEJKI I KSZTAŁT GOLENI (ze zdjęć) ==="), "ściąga w poleceniu");
    assert.ok(p.indexOf("ŚCIĄGA WIDELCÓW") < p.indexOf("=== KONIEC CZĘŚCI OGÓLNEJ BAZY ==="), "w części stałej (cache)");
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
