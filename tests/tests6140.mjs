import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.14: „24 Zoll” w tytule spoza listy modeli wywracał cykl („Cannot read properties of undefined (reading 'toLowerCase')”) —
// titleHasKnownModel czytał b.query także dla wyszukiwań-kategorii (Giant, Dirt, Dirtbike), które go nie mają.
// Oferta zostawała w kolejce, więc każdy kolejny cykl wywracał się w tym samym miejscu (skaner stał od 15.11.2026 9:25).
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const A = { id: "1000000001", title: "Canyon Torque alt", price: 1000 };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };

await test("„24 / 20 / 16 Zoll” w tytule bez znanego modelu → odrzucone filtrem słów, cykl się nie wywraca i kolejka jest pusta", async () => {
  let phase = 1;
  const B = [
    { id: "2000006141", title: "Specialized 24 Zoll Dirt Jump Bike orange", price: 270 },
    { id: "2000006142", title: "Mountainbike 20 Zoll gebraucht", price: 300 },
    { id: "2000006143", title: "Fahrrad 16 Zoll blau", price: 250 },
  ];
  const app = await openApp({ world: { detail: () => ({ desc: "Gut erhalten, Abholung.", images: 3 }),
    ai: (b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", cena_zakupu_eur: 270, szacowana_sprzedaz_eur: 300, przewidywany_zysk: -40 })),
    search: (k) => k === "torque" ? [A, ...(phase >= 2 ? B : [])] : [] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitLog(/Cykl #3 zakończony/, 60000);
    assert.equal(await app.countLogs(/Nieoczekiwany błąd w cyklu/), 0, "żaden cykl się nie wywrócił");
    assert.equal(await app.countLogs(/toLowerCase/), 0, "bez błędu toLowerCase");
    assert.equal(genReqs(app.st).length, 0, "bez analizy AI");
    assert.equal(JSON.parse(await app.ls("ddf_pending") || "[]").length, 0, "kolejka pusta");
    // zapis pamięci widzianych bywa chwilę po końcu cyklu — czekamy na powód odrzucenia
    let seen = [];
    for (let i = 0; i < 40; i++) { seen = JSON.parse(await app.ls("ddf_seen") || "[]"); if (B.every(b => seen.find(e => e.id === b.id)?.rej)) break; await app.page.waitForTimeout(250); }
    for (const b of B) assert.equal(seen.find(e => e.id === b.id)?.rej, "slowa", `odrzucone filtrem słów: ${b.title}`);
  } finally { await close(app); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
