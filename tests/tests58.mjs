import { openApp, closeBrowser, analysisJson, geminiResp, groqResp } from "./harness.mjs";
import assert from "node:assert/strict";
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const B = { id: "2000000002", title: "Canyon Torque AL 6 2021 L", price: 900 };
const GOOD = "Sehr gepflegtes Canyon Torque AL 6, Fox 38 Performance, Float X2, SRAM GX Eagle, Code R Bremsen, Größe L, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const href = (l) => `https://www.kleinanzeigen.de/s-anzeige/x/${l.id}-217-1234`;
const ALL_BIKE_IDS = [...(await import("node:fs")).readFileSync(new URL("../public/index.html", import.meta.url), "utf8").matchAll(/\{ id: "([a-z0-9_]+)",\s+label:/g)].map(m => m[1]);
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const twoPhase = async (opts, after) => {
  let phase = 1;
  const app = await openApp({ ...opts, world: { ...opts.world, search: () => [A, ...(phase >= 2 ? (opts.newOnes || [B]) : [])] } });
  await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
  try { await after(app); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
};

await test("Captcha nie jest pustym wynikiem", async () => {
  let captcha = true;
  const app = await openApp({ cfg: { knownBikes: ALL_BIKE_IDS }, world: { search: () => captcha ? [] : [A], ai: () => ({}) } });
  // strona z captcha: podmieniamy odpowiedź wyszukiwania
  await app.page.route("**/api/scrape?*", (route) => {
    const t = decodeURIComponent(new URL(route.request().url()).searchParams.get("url"));
    if (captcha && !t.includes("/s-anzeige/")) return route.fulfill({ body: "<html><body>Bitte bestätigen: captcha</body></html>", contentType: "text/html" });
    return route.fallback();
  });
  await app.start();
  await app.waitLog(/captcha/);
  await app.waitLog(/Cykl #1 zakończony/);
  assert.equal(await app.countLogs(/pierwsze skanowanie/), 0, "bez inicjalizacji przy captcha");
  const st = JSON.parse(await app.ls("ddf_scan_state") || '{"searches":{}}');
  assert.ok(!st.searches.canyon_torque, "brak stanu po captcha");
  captcha = false;
  await app.waitLog(/Canyon Torque: pierwsze skanowanie tego wyszukiwania — zapamiętano 1/, 20000);
  await app.stop(); await app.waitStopped(); await app.close();
});

await test("Puste wyszukiwanie → 6 nowych z dzisiejszą datą idzie do analizy", async () => {
  let phase = 1;
  const six = Array.from({ length: 6 }, (_, i) => ({ id: `50000000${10 + i}`, title: `Canyon Torque nr ${i}`, price: 900 + i, date: "Heute, 00:01" }));
  const app = await openApp({ cfg: { maxGeminiPerCycle: 25 }, world: { search: (key) => key !== "torque" ? [] : phase >= 2 ? six : [], detail: () => ({ desc: GOOD }),
    ai: (b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", szacowana_sprzedaz_eur: 950 })) } });
  await app.start(); await app.waitLog(/Canyon Torque: pierwsze skanowanie tego wyszukiwania — zapamiętano 0/); await app.waitLog(/Cykl #1 zakończony/);
  phase = 2;
  await app.waitLog(/wcześniej puste wyszukiwanie — nagle 6 ofert — analizuję 6 ofert z ostatnich 24 h/);
  await app.waitUntil(() => genReqs(app.st).length >= 6, 30000, "6 analiz");
  await app.stop(); await app.waitStopped(); await app.close();
});

await test("Weryfikacja i niepewne: wszystkie zdjęcia (12)", async () => {
  let n = 0;
  await twoPhase({ world: { detail: () => ({ desc: GOOD, images: 12 }),
    ai: (b) => { if (b.action) return {}; n++; return geminiResp(n === 1 ? analysisJson({ decyzja: "niepewne", niepewne_kategoria: "mozliwe_uszkodzenia" }) : analysisJson(), { imagesAttached: b.imageUrls?.length || 0 }); } } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "deal");
    const g = genReqs(app.st);
    if (process.env.DBG) console.log("DBG", JSON.stringify(app.st.discord.map(d => d.payload.content || d.payload.embeds?.[0]?.title)), (await app.logs()).filter(l => /Zielony|Weryf|dokładn|tak|niepewne/i.test(l)).slice(-12).join("\n"));
    assert.deepEqual(g.map(b => b.imageUrls.length), [4, 12, 12]);
    assert.ok(isVer(g[2]));
    const f = app.st.discord[0].payload.embeds[0].fields.find(x => x.name.includes("Weryfikacja"));
    assert.equal(f.value, "ze zdjęciami (12) i pełnym opisem");
  });
});

await test("STOP w trakcie dokładniejszej analizy — oferta zostaje w kolejce", async () => {
  let n = 0;
  await twoPhase({ world: { detail: () => ({ desc: GOOD, images: 6 }),
    ai: (b) => { if (b.action) return {}; n++; return n === 1 ? geminiResp(analysisJson({ decyzja: "niepewne", niepewne_kategoria: "za_malo_opisu" })) : { __delay: 3000, __json: geminiResp(analysisJson()) }; } } }, async (app) => {
    await app.waitUntil(() => genReqs(app.st).length >= 2, 15000, "eskalacja");
    await app.stop(); await app.waitStopped(20000);
    const pend = JSON.parse(await app.ls("ddf_pending"));
    assert.equal(pend.length, 1, "oferta w kolejce");
    assert.equal(JSON.parse(await app.ls("ddf_outbox")).length, 0, "nic do niepewnych");
  });
});

await test("Sprzeczny typ pamiętany do weryfikacji", async () => {
  let n = 0;
  await twoPhase({ cfg: { groqClassifierKey: "gsk_x" }, world: { groq: () => groqResp("full"), detail: () => ({ desc: GOOD, images: 4 }),
    ai: (b) => { if (b.action) return {}; n++; return geminiResp(analysisJson({ typ_roweru: n === 1 ? "dirt" : "full" }), { imagesAttached: b.imageUrls?.length || 0 }); } } }, async (app) => {
    await app.waitUntil(() => app.st.discord.length >= 1, 20000, "wiadomość");
    const v = genReqs(app.st).find(isVer);
    assert.ok(promptOf(v).includes("9. TYP ROWERU — Etap 1 (Groq) rozpoznał typ „full”, a jedna z analiz AI „dirt”"));
    const f = app.st.discord[0].payload.embeds[0].fields.find(x => x.name.includes("Weryfikacja"));
    assert.ok(f.value.includes("sprzeczny typ rozstrzygnięty: „full”"));
  });
});

await test("Brak ceny w nowym skanie → strona ogłoszenia → odrzucone", async () => {
  const app = await openApp({ cfg: { aiBudgetPln: 400 }, ls: { ddf_seen: [{ id: href(B), price: 700, lowest: 700 }], ddf_scan_state: { searches: { canyon_torque: { baselineAt: Date.now(), lastScanAt: Date.now() } } },
    ddf_pending: [{ listing: { listingId: href(B), title: B.title, price: 700, href: href(B), desc: "x" }, stage: "analyze", groqType: "full", attempts: 0, addedAt: Date.now() }] },
    world: { search: () => [{ ...B, price: "VB" }], detail: () => ({ desc: GOOD }), ai: (b) => b.action ? {} : geminiResp(analysisJson()) } });
  await app.start();
  await app.waitLog(/brak ceny w nowym skanie \(było 700€\)/);
  await app.waitLog(/Brak ceny także na stronie ogłoszenia — odrzucono bez AI/);
  assert.equal(app.st.discord.length, 0);
  assert.equal(genReqs(app.st).length, 0);
  await app.stop(); await app.waitStopped(); await app.close();
});

await test("Zaległa okazja do usuniętego ogłoszenia nie jest wysyłana", async () => {
  const app = await openApp({ ls: { ddf_scan_state: { searches: {} }, ddf_outbox: [{ id: "o1", kind: "deal", listing: { listingId: href(B), title: B.title, price: 900, href: href(B) }, analysis: { typ_roweru: "full", przewidywany_zysk: 500, krotki_opis: "x", fakty: {} }, addedAt: Date.now() - 2 * 3600e3, tries: 1 }] },
    world: { search: () => [A], detail: () => ({ status: 404 }), ai: () => ({}) } });
  await app.start();
  await app.waitLog(/Zaległa okazja nie wysłana — ogłoszenie zostało usunięte/);
  assert.equal(app.st.discord.length, 0);
  assert.equal(JSON.parse(await app.ls("ddf_outbox")).length, 0);
  await app.stop(); await app.waitStopped(); await app.close();
});

await closeBrowser();
console.log(results.join("\n"));
process.exit(results.some(r => r.startsWith("❌")) ? 1 : 0);
