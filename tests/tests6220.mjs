import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.22 (decyzje właściciela 18.11.2026): dirt marki nieznanej / custom — rama jak półka „Najtańsze dirty”, części według
// wartości; WARTOŚĆ DROGICH CZĘŚCI dla wszystkich dirtów (I9 najdroższe: koła ok. 4000 zł, tylna piasta ok. 1000 zł).
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const A = { id: "1000000001", title: "Canyon Torque alt", price: 1000 };
const B = { id: "2000006221", title: "Custom Dirtbike dirtjumper slopestyle bike Noa hubs", price: 830 };
const DESC = "Custom Dirtbike, Marzocchi Bomber DJ Gabel, NOA Naben, Hope Bremse, gepflegt. Abholung in Berlin.";
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }

await test("Dirt custom z Bomber DJ: w prompcie reguła ramy z najtańszej półki + części według wartości", async () => {
  let phase = 1;
  const app = await openApp({ world: { detail: () => ({ desc: DESC, images: 4 }),
    ai: (b) => b.action ? {} : geminiResp(analysisJson({ typ_roweru: "dirt", decyzja: "nie", przewidywany_zysk: -100 })),
    search: () => [A, ...(phase >= 2 ? [B] : [])] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes("Noa hubs")), 20000, "analiza AI dirta");
    const p = promptOf(genReqs(app.st).find(b => promptOf(b).includes("Noa hubs")));
    assert.ok(p.includes("RAMA liczona jak półka „Najtańsze dirty”, a CZĘŚCI według tego, czym są"), "reguła w bazie dirtów");
    assert.ok(p.includes("rama bez marki / custom + Pike DJ / Bomber DJ, reszta podstawowa | sprzedaż PL 3200–3800 zł"), "pasmo z widelcem");
    assert.ok(p.includes("rama bez marki / custom + Pike DJ / Bomber DJ + drogie części | sprzedaż PL 4000–6000+ zł"), "pasmo z drogimi częściami");
    assert.ok(p.includes("koła Industry Nine na kolorowych (aluminiowych) szprychach są warte ok. 4000 zł"), "wartość kół I9");
    assert.ok(p.includes("sama tylna piasta Industry Nine ok. 1000 zł") && p.includes("Hope Tech 4 jest wart wyraźnie więcej niż Tech 3"), "piasta I9 i Hope Tech 3/4");
    assert.ok(p.includes("z kołami Industry Nine → bliżej 7000–8000 zł"), "przykład z I9");
    assert.ok(p.includes("Pike DJ / Bomber DJ + drogie części | sprzedaż PL 4500–6000 zł"), "półka podstawowa z drogimi częściami");
    assert.ok(!p.includes("tylko o ok. 300–500 zł"), "stara zasada 300–500 zł usunięta");
    assert.ok(p.includes("Marka części (np. piasty NOA, Hope, Industry Nine) to nie marka ramy"), "instrukcja: marka części ≠ marka ramy");
    assert.ok(!p.includes("Marka nieznana → wyceniaj w półce „Najtańsze dirty”."), "stara reguła usunięta");
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
