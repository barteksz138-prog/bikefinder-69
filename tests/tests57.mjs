import { openApp, closeBrowser, analysisJson, geminiResp, groqResp, IMG } from "./harness.mjs";
import assert from "node:assert/strict";
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const B = { id: "2000000002", title: "Canyon Torque AL 6 2021 L", price: 900 };
const GOOD = "Sehr gepflegtes Canyon Torque AL 6, Fox 38 Performance, Float X2, SRAM GX Eagle, Code R Bremsen, Größe L, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const results = [];
async function test(name, fn) { const t0 = Date.now(); try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${e.message}`); } }
const twoPhase = async (opts, after) => {
  let phase = 1;
  const app = await openApp({ ...opts, world: { ...opts.world, search: () => [A, ...(phase >= 2 ? (opts.newOnes || [B]) : [])] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
};

await test("Zdjęcia przy każdej analizie (dobry opis) + tylko galeria ogłoszenia", async () => {
  await twoPhase({ world: { detail: () => ({ desc: GOOD, images: 3, foreign: true }), ai: (b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 950 })) } }, async (app) => {
    await app.waitUntil(() => genReqs(app.st).length >= 1, 15000, "analiza");
    const r = genReqs(app.st)[0];
    assert.deepEqual(r.imageUrls, [IMG(1), IMG(2), IMG(3)].map(u => u.replace("$_59.JPG", "$_59.JPG")));
    assert.ok(!r.imageUrls.includes(IMG(8)) && !r.imageUrls.includes(IMG(9)), "bez obcych zdjęć");
  });
});

await test("Niepewne → dokładniejsza analiza ze wszystkimi zdjęciami", async () => {
  let n = 0;
  await twoPhase({ world: { detail: () => ({ desc: GOOD, images: 8 }),
    ai: (b) => { if (b.action) return {}; n++;
      return geminiResp(n === 1 ? analysisJson({ decyzja: "niepewne", niepewne_kategoria: "za_malo_opisu", powod_decyzji: "nie widać osprzętu" }) : analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 950 }), { imagesAttached: b.imageUrls?.length || 0 }); } } }, async (app) => {
    await app.waitLog(/druga, dokładniejsza analiza \(.*zdjęć: 8\)/);
    await app.waitUntil(() => genReqs(app.st).length >= 2, 15000, "2 analizy");
    const g = genReqs(app.st);
    assert.deepEqual(g.map(b => b.imageUrls.length), [4, 8]);
    assert.ok(promptOf(g[1]).includes("WSZYSTKIE ZDJĘCIA"));
  });
});

await test("Weryfikacja: uczciwa etykieta ze zdjęciami / bez", async () => {
  for (const attached of [4, 0]) {
    await twoPhase({ world: { detail: () => ({ desc: GOOD, images: 4 }), ai: (b) => b.action ? {} : geminiResp(analysisJson(), { imagesAttached: attached }) } }, async (app) => {
      await app.waitUntil(() => app.st.discord.length >= 1, 15000, "deal");
      const f = app.st.discord[0].payload.embeds[0].fields.find(x => x.name.includes("Weryfikacja"));
      assert.equal(f.value, attached ? "ze zdjęciami (4) i pełnym opisem" : "TYLKO z opisu — zdjęć nie udało się pobrać");
    });
  }
});

await test("Blokada strony ogłoszenia → czekanie; po 2 h ocena z fragmentu, 'tak' → niepewne", async () => {
  await twoPhase({ world: { detail: () => ({ status: 403 }), ai: (b) => b.action ? {} : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitLog(/oferty czekają w kolejce \(do 2 h\)/);
    await app.page.waitForTimeout(1500);
    assert.equal(genReqs(app.st).length, 0, "bez analizy z fragmentu");
    const pend = JSON.parse(await app.ls("ddf_pending"));
    assert.equal(pend.length, 1); assert.ok(pend[0].detailsMissingSince > 0);
  });
  const old = Date.now() - 3 * 3600e3;
  const app = await openApp({ ls: { ddf_scan_state: { searches: {} }, ddf_pending: [{ listing: { listingId: "https://www.kleinanzeigen.de/s-anzeige/x/2000000002-217-1234", title: B.title, price: 900, href: "https://www.kleinanzeigen.de/s-anzeige/x/2000000002-217-1234", desc: "kurz" }, stage: "analyze", groqType: "full", attempts: 0, addedAt: Date.now() - 3 * 3600e3, detailsMissingSince: old }] },
    world: { search: () => [A], detail: () => ({ status: 500 }), ai: (b) => b.action ? {} : geminiResp(analysisJson()) } });
  await app.start();
  await app.waitLog(/oceniona tylko z krótkiego fragmentu .* przenoszę do niepewnych/, 20000);
  assert.equal(genReqs(app.st).filter(isVer).length, 0, "bez kosztownej weryfikacji");
  await app.waitUntil(() => app.st.discord.some(d => d.webhookUrl.includes("/2/") && d.payload.content.includes("pełny opis był niedostępny")), 15000, "niepewne");
  await app.stop(); await app.waitStopped(); await app.close();
});

await test("Kolejka: aktualna cena z listy wyników", async () => {
  const href = "https://www.kleinanzeigen.de/s-anzeige/x/2000000002-217-1234";
  const app = await openApp({ cfg: { aiBudgetPln: 400 }, ls: { ddf_seen: [{ id: href, price: 700, lowest: 700 }], ddf_scan_state: { searches: { canyon_torque: { baselineAt: Date.now(), lastScanAt: Date.now() } } },
    ddf_pending: [{ listing: { listingId: href, title: B.title, price: 700, href, desc: "x" }, stage: "analyze", groqType: "full", attempts: 0, addedAt: Date.now() }] },
    world: { search: () => [{ ...B, price: 900 }], detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 950 })) } });
  await app.start();
  await app.waitLog(/zmiana ceny 700€ → 900€/);
  await app.waitUntil(() => genReqs(app.st).length >= 1, 15000, "analiza");
  assert.ok(promptOf(genReqs(app.st)[0]).includes("Cena z ogłoszenia: 900€"));
  await app.stop(); await app.waitStopped(); await app.close();
});

await test("Sprzeczny typ (Groq full, AI dirt) → v5.11: typ od AI, okazja po weryfikacji", async () => {
  await twoPhase({ cfg: { groqClassifierKey: "gsk_x" }, world: { groq: () => groqResp("full"), detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson({ typ_roweru: "dirt" })) } }, async (app) => {
    await app.waitLog(/Sprzeczne rozpoznanie typu: Etap 1 \(Groq\) „full”, analiza AI ze zdjęciami „dirt” — przyjmuję typ od AI/);
    await app.waitUntil(() => app.st.discord.some(d => d.payload.embeds), 15000, "okazja");
  });
});

await test("Puste pierwsze wyszukiwanie → pierwsza oferta analizowana", async () => {
  let phase = 1;
  const app = await openApp({ world: { search: (key) => key !== "torque" ? [] : phase >= 2 ? [B] : [], detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 950 })) } });
  await app.start(); await app.waitLog(/Canyon Torque: pierwsze skanowanie tego wyszukiwania — zapamiętano 0/); await app.waitLog(/Cykl #1 zakończony/);
  phase = 2;
  await app.waitUntil(() => genReqs(app.st).length >= 1, 15000, "analiza B");
  await app.stop(); await app.waitStopped(); await app.close();
});

await test("Negacja 'nicht nur Rahmen' nie odrzuca", async () => {
  const C = { id: "3000000003", title: "Canyon Torque CF 2022", price: 1100, desc: "Komplettes Fahrrad, nicht nur Rahmen." };
  const F = { id: "4000000004", title: "Canyon Torque 2021", price: 500, desc: "Verkaufe nur den Rahmen mit Dämpfer" };
  await twoPhase({ newOnes: [C, F], world: { detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 950 })) } }, async (app) => {
    await app.waitLog(/Filtr: odrzucono \(słowo: "nur den Rahmen \(w opisie\)"\) — Canyon Torque 2021/);
    await app.waitUntil(() => genReqs(app.st).some(b => promptOf(b).includes(C.title)), 15000, "C analizowany");
  });
});

await test("Sonnet do weryfikacji, Gemini do analizy — właściwe klucze i modele", async () => {
  await twoPhase({ cfg: { strongModel: "claude-sonnet-5-5", claudeKey: "sk-ant-s" }, world: { detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson()) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 15000, "deal");
    const g = genReqs(app.st);
    assert.equal(g[0].provider, "gemini"); assert.equal(g[0].apiKey, "AIza-test");
    const v = g.find(isVer);
    assert.equal(v.provider, "anthropic"); assert.equal(v.model, "claude-sonnet-5-5"); assert.equal(v.apiKey, "sk-ant-s");
    assert.equal(v.generationConfig.claudeEffort, "high");
    assert.ok(!v.messages[0].parts[0].cacheControl, "v5.11: rzadki model weryfikacji bez zapisu do cache");
    assert.equal(g[0].messages[0].parts[0].cacheControl, true, "model analizy z cache");
  });
});

await test("Dokładniejsza analiza na modelu analizy (nie na mocnym)", async () => {
  let n = 0;
  await twoPhase({ cfg: { strongModel: "claude-sonnet-5-5", claudeKey: "sk-ant-s" }, world: { detail: () => ({ desc: GOOD, images: 2 }),
    ai: (b) => { if (b.action) return {}; n++; return geminiResp(n === 1 ? analysisJson({ decyzja: "niepewne", niepewne_kategoria: "nisza_custom" }) : analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 950 })); } } }, async (app) => {
    await app.waitLog(/druga, dokładniejsza analiza \(gemini-2\.5-flash, myślenie 8192/);
    await app.waitUntil(() => genReqs(app.st).length >= 2, 15000, "2 analizy");
    assert.ok(genReqs(app.st).every(b => b.provider === "gemini"));
  });
});

await test("Czat respektuje budżet", async () => {
  const app = await openApp({ cfg: { aiBudgetPln: 0 }, world: { search: () => [], ai: () => geminiResp("x") } });
  await app.page.getByRole("button", { name: /Chat AI/ }).click();
  await app.page.locator("textarea, input[type=text]").last().fill("Test");
  await app.page.keyboard.press("Enter");
  await app.page.getByText(/Budżet AI na ten miesiąc wyczerpany/).waitFor({ timeout: 8000 });
  assert.equal(app.st.aiReqs.length, 0);
  await app.close();
});

await test("STOP podczas czekania na ponowienie Discorda (429)", async () => {
  await twoPhase({ world: { detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson()),
    discord: () => ({ ok: false, status: 429, retryAfter: 10, error: "rate limited" }) } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 15000, "pierwsza próba");
    await app.stop(); await app.waitStopped();
    await app.page.waitForTimeout(2500);
    assert.equal(app.st.discord.length, 1, "bez ponowienia po STOP");
    assert.equal(JSON.parse(await app.ls("ddf_outbox")).length, 1, "okazja czeka");
  });
});

await closeBrowser();
console.log(results.join("\n"));
process.exit(results.some(r => r.startsWith("❌")) ? 1 : 0);
