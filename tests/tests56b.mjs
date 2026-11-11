import { openApp, closeBrowser, analysisJson, geminiResp, groqResp } from "./harness.mjs";
import assert from "node:assert/strict";
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const B = { id: "2000000002", title: "Canyon Torque AL 6 2021 L", price: 900 };
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${e.message}`); } }

// Okazja: Discord nie odpowiada → czeka; w następnym cyklu wysłana, status w Wynikach zmienia się na "wysłane"
await test("Niewysłana okazja jest ponawiana", async () => {
  let phase = 1, fail = true;
  const app = await openApp({ world: { search: () => [A, ...(phase >= 2 ? [B] : [])], ai: (b) => b.action ? {} : geminiResp(analysisJson()),
    discord: (b) => fail ? { ok: false, status: 500, retryAfter: null, error: "Internal" } : { ok: true, status: 204 } } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitLog(/okazja NIE wysłana \(HTTP 500/);
  assert.equal(JSON.parse(await app.ls("ddf_outbox")).length, 1);
  fail = false;
  await app.waitLog(/Wysłano na Discord: Canyon Torque AL 6/, 15000);
  assert.equal(JSON.parse(await app.ls("ddf_outbox")).length, 0);
  assert.equal(genReqs(app.st).length, 2, "bez ponownej analizy — tylko ponowna wysyłka");
  await app.stop(); await app.waitStopped();
  await app.page.getByRole("button", { name: /Wyniki/ }).click();
  await app.page.waitForTimeout(300);
  await app.close();
});

// Brak ceny → lista niepewnych na końcu cyklu
await test("Brak ceny → odrzucone bez AI i bez listy niepewnych", async () => {
  let phase = 1;
  const NP = { id: "8000000008", title: "Canyon Torque VB", price: "VB" };
  const app = await openApp({ world: { search: () => [A, ...(phase >= 2 ? [NP] : [])], ai: (b) => b.action ? {} : geminiResp(analysisJson()) } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitLog(/Brak ceny — odrzucono bez AI: Canyon Torque VB/);
  await app.waitLog(/Cykl #2 zakończony/);
  assert.equal(genReqs(app.st).length, 0); assert.equal(app.st.discord.length, 0);
  await app.stop(); await app.waitStopped(); await app.close();
});

// Budżet wystarcza na pierwszą analizę Flash, ale nie na weryfikację Pro → okazja do niepewnych, nie wysłana jako okazja
await test("Budżet kończy się przy weryfikacji → niepewne", async () => {
  let phase = 1;
  const app = await openApp({ cfg: { aiBudgetPln: 0.5 }, world: { search: () => [A, ...(phase >= 2 ? [B] : [])], ai: (b) => b.action ? {} : geminiResp(analysisJson(), { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } }) } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitLog(/Weryfikacja okazji niemożliwa — budżet AI wyczerpany/);
  await app.waitUntil(() => app.st.discord.some(d => d.webhookUrl.includes("/2/") && d.payload.content.includes("NIEZWERYFIKOWANA")), 15000, "niepewne z B");
  assert.ok(!app.st.discord.some(d => d.payload.embeds), "brak wiadomości z okazją");
  assert.equal(genReqs(app.st).filter(isVer).length, 0);
  await app.stop(); await app.waitStopped(); await app.close();
});

// Groq z kluczem: "full" → analiza z typem zaufanym; Groq zwraca błąd → bez progu ceny
await test("Groq: typ zaufany i awaria", async () => {
  let phase = 1, groqFail = false;
  const cheap = { id: "9000000009", title: "Canyon Torque AL 450", price: 450 };
  const app = await openApp({ cfg: { groqClassifierKey: "gsk_x" }, world: { search: () => [A, ...(phase >= 2 ? [B] : []), ...(phase >= 3 ? [cheap] : [])],
    ai: (b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 950 })),
    groq: () => groqFail ? { error: { message: "Service unavailable" } } : groqResp("full") } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  await app.waitUntil(() => genReqs(app.st).length >= 1, 15000, "analiza B");
  assert.ok(promptOf(genReqs(app.st)[0]).includes('jako typ: "full"'));
  groqFail = true; phase = 3;
  await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes(cheap.title)), 15000, "tania oferta mimo awarii Groqa");
  await app.waitLog(/Groq niedostępny \(bez progu ceny\)/);
  await app.stop(); await app.waitStopped(); await app.close();
});

await closeBrowser();
console.log(results.join("\n"));
process.exit(results.some(r => r.startsWith("❌")) ? 1 : 0);
