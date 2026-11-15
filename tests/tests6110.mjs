import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.11: poprawki z przeglądu v6.8 — nocne sprawdzanie a blokada, kolejka przy wstrzymanym AI, pola ustawień,
// filtr słów („nur der Rahmen hat…”, „20 Zoll” jako rozmiar ramy), rocznik „Bj. 2016/2017”, obniżka odrzuconego na stałe, cardTitle w kolejce
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque alt", price: 1000 };
const HREF = (id) => `https://www.kleinanzeigen.de/s-anzeige/x/${id}-217-1234`;
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 400)}`); } }
const close = async (app) => { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); };
const ai = (o = {}) => (b) => b.action ? {} : geminiResp(analysisJson({ decyzja: "nie", cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1000, przewidywany_zysk: 30, ...o }));
const titledReq = (st, t) => genReqs(st).some(b => promptOf(b).includes(t));

// ── Filtr słów i rocznik — wcześniej odrzucane na stałe bez AI ──
await test("„20 Zoll” przy Cube Stereo 27,5, „nur der Rahmen hat Kratzer”, „Bj. 2016/2017” → idą do analizy AI", async () => {
  let phase = 1;
  const C = { id: "2000006101", title: "Cube Stereo 140 HPC Race 27,5 20 Zoll", price: 900 };
  const R = { id: "2000006102", title: "Canyon Torque AL 6", price: 900, desc: "Das Bike ist top gepflegt, nur der Rahmen hat ein paar Kratzer." };
  const Y = { id: "2000006103", title: "Canyon Torque Bj. 2016/2017", price: 900 };
  const K = { id: "2000006104", title: "Kinderfahrrad 20 Zoll", price: 250 };
  const F = { id: "2000006105", title: "Canyon Torque Rahmen", price: 400, desc: "Verkaufe nur den Rahmen, ohne Teile." };
  const app = await openApp({ world: { search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [C, R, Y, K, F] : [])] : [], detail: () => ({ desc: GOOD, images: 4 }), ai: ai() } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitUntil(() => titledReq(app.st, C.title) && titledReq(app.st, "Canyon Torque AL 6") && titledReq(app.st, Y.title), 30000, "trzy analizy");
    await app.waitQueueEmpty();
    assert.ok(!titledReq(app.st, K.title), "rower dziecięcy 20 Zoll nadal odrzucany bez AI");
    assert.ok(!titledReq(app.st, "Canyon Torque Rahmen"), "„nur den Rahmen” nadal odrzucane");
    assert.equal(await app.countLogs(/2016 < 2017/), 0, "rocznik 2017, nie 2016");
  } finally { await close(app); }
});

// ── Obniżka ogłoszenia odrzuconego na stałe nie wraca do płatnej analizy ──
await test("Obniżka o 30% roweru odrzuconego jako „stary” → bez analizy AI", async () => {
  let phase = 1;
  const S = { id: "2000006111", title: "Canyon Torque Alt Stary", price: 700 };
  const seen = [{ id: S.id, price: 1000, lowest: 1000, type: "full", lastSeenAt: Date.now() - 3600e3, rej: "stary", watchSale: 1400, watchT: 70 }];
  const app = await openApp({ ls: { ddf_seen: seen }, world: { search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [S] : [])] : [], detail: () => ({ desc: GOOD }), ai: ai() } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitLog(/Cykl #2 zakończony/, 30000);
    await app.waitQueueEmpty();
    assert.ok(!titledReq(app.st, S.title), "bez analizy");
    assert.equal(await app.countLogs(/spadków ceny na znanych/), 0);
  } finally { await close(app); }
});

// ── Kolejka przy wstrzymanym AI: oferta sprzed 50 h nie przepada; cardTitle przetrwa zapis ──
await test("Budżet AI wyczerpany: oferta sprzed 50 h zostaje w kolejce (z cardTitle), czas postoju doliczony", async () => {
  const job = { listing: { listingId: "2000006121", title: "Canyon Torque Strona", cardTitle: "Canyon Torque Karta", price: 900, href: HREF("2000006121"), desc: "", bike: "Canyon Torque" },
    source: "new", stage: "analyze", groqType: "full", attempts: 0, addedAt: Date.now() - 50 * 3600e3, nextAttemptAt: 0 };
  const app = await openApp({ cfg: { aiBudgetPln: 0 }, ls: { ddf_pending: [job] }, world: { search: (k) => k === "torque" ? [A] : [], detail: () => ({ desc: GOOD }), ai: ai() } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/);
    await app.waitLog(/Cykl #2 zakończony/, 30000);
    await app.stop(); await app.waitStopped();
    const pend = JSON.parse(await app.ls("ddf_pending"));
    const j = pend.find(x => x.listing.listingId === "2000006121");
    assert.ok(j, "oferta nadal w kolejce");
    assert.equal(j.listing.cardTitle, "Canyon Torque Karta", "cardTitle zapisany");
    assert.ok(j.pausedMs > 0, `doliczony czas postoju (${j.pausedMs})`);
    assert.equal(app.st.aiReqs.length, 0);
  } finally { await app.close(); }
});

await test("AI działa: oferta sprzed 50 h (bez postoju) nadal usuwana z kolejki", async () => {
  const job = { listing: { listingId: "2000006122", title: "Canyon Torque Stara Kolejka", price: 900, href: HREF("2000006122"), desc: "", bike: "Canyon Torque" },
    source: "new", stage: "analyze", groqType: "full", attempts: 0, addedAt: Date.now() - 50 * 3600e3, nextAttemptAt: 0 };
  const app = await openApp({ ls: { ddf_pending: [job] }, world: { search: (k) => k === "torque" ? [A] : [], detail: () => ({ desc: GOOD }), ai: ai() } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/);
    await app.waitQueueEmpty();
    assert.ok(!titledReq(app.st, "Canyon Torque Stara Kolejka"), "przeterminowana — bez analizy");
  } finally { await close(app); }
});

// ── Nocne sprawdzanie cen a blokada ──
await test("Nocne sprawdzanie: 403 na stronie ogłoszenia → przerwa 30 min i komunikat, bez kolejnych zapytań", async () => {
  const old = Date.now() - 3 * 24 * 3600e3;
  const ids = ["2000006131", "2000006132", "2000006133"];
  const seen = ids.map(id => ({ id, price: 1600, lowest: 1600, overMax: true, lastSeenAt: old }));
  const app = await openApp({ cfg: { nightCheckHour: new Date().getHours(), statusWebhook: "https://discord.com/api/webhooks/4/status" }, ls: { ddf_seen: seen },
    world: { search: (k) => k === "torque" ? [A] : [], detail: (id) => ids.includes(id) ? { status: 403 } : { desc: GOOD }, ai: ai() } });
  try {
    await app.start();
    await app.waitLog(/Nocne sprawdzanie cen: Kleinanzeigen blokuje .* przerwa w pobieraniu stron ogłoszeń na 30 min/, 20000);
    await app.waitLog(/Cykl #2 zakończony/, 30000);
    assert.equal(app.st.detailCalls.filter(id => ids.includes(id)).length, 1, "jedno zapytanie, potem przerwa");
    assert.ok(await app.countLogs(/Nocne sprawdzanie cen czeka — przerwa po blokadzie/) >= 1, "log o czekaniu");
    assert.ok(app.st.discord.some(d => d.webhookUrl.includes("/4/status") && /nocnego sprawdzania cen/.test(d.payload.content || JSON.stringify(d.payload))), "komunikat na kanale problemów");
  } finally { await close(app); }
});

// ── Pola liczbowe ustawień: zapis dopiero po zatwierdzeniu i tylko poprawnej wartości ──
await test("Próg zysku: wartości pośrednie nie trafiają do ustawień; < 5% odrzucone; 33 po Enter zapisane", async () => {
  const app = await openApp({ cfg: { profitTiers: [40, 40, 40, 40] }, world: { search: () => [], ai: ai() } });
  try {
    await app.page.getByRole("button", { name: "⚙️ Ustawienia" }).click();
    const inp = app.page.locator('input[type=number][min="5"]').first();
    const tiers = async () => JSON.parse(await app.ls("ddf_cfg")).profitTiers;
    await inp.fill("3"); await app.page.waitForTimeout(600);
    assert.deepEqual(await tiers(), [40, 40, 40, 40], "w trakcie wpisywania bez zmian");
    await inp.press("Enter"); await app.page.waitForTimeout(600);
    assert.deepEqual(await tiers(), [40, 40, 40, 40], "3% < 5% — odrzucone");
    assert.equal(await inp.inputValue(), "40", "pole wraca do zapisanej wartości");
    await inp.fill("33"); await inp.press("Enter"); await app.page.waitForTimeout(600);
    assert.deepEqual(await tiers(), [33, 40, 40, 40], "33 zapisane");
  } finally { await app.close(); }
});

await closeBrowser();
console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
