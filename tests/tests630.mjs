import { openApp, closeBrowser, analysisJson, geminiResp } from "./harness.mjs";
import assert from "node:assert/strict";
// v6.3: zbieranie ofert niezależne od AI (wykonawca AI w tle), STOP kończy oba przebiegi, priorytet wg czasu czekania,
// rotacja początku listy wyszukiwań, zakres cen w linkach, czas od wykrycia do alertu
const promptOf = (b) => (b.messages?.[0]?.parts || []).map(p => p.text || "").join("\n") || b.messages?.[0]?.content || "";
const isVer = (b) => promptOf(b).includes("TRYB WERYFIKACJI");
const genReqs = (st) => st.aiReqs.filter(b => !b.action);
const deals = (st) => st.discord.filter(d => d.payload.embeds && /OKAZJA/.test(d.payload.embeds[0].title));
const GOOD = "Sehr gepflegtes Bike, Gabel und Bremsen top, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung in Berlin.";
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const HREF = (id) => `https://www.kleinanzeigen.de/s-anzeige/x/${id}-217-1234`;
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${String(e.message).replace(/\s+/g, " ").slice(0, 300)}`); } }
const aiResp = (o = {}, delay = 0) => (b) => b.action ? {} : { ...geminiResp(analysisJson(o), { imagesAttached: b.imageUrls?.length || 0 }), ...(delay ? { __delay: delay } : {}) };
const TWO = ["canyon_torque", "trek_slash"];

await test("Wolna analiza AI (3 s) nie wstrzymuje wyszukiwań — kolejne idą w trakcie analizy", async () => {
  let phase = 1, aiStart = null;
  const slashAt = [];
  const B = { id: "2000000631", title: "Canyon Torque CF Slow", price: 900 };
  const ai = (b) => { if (!b.action && aiStart == null && promptOf(b).includes(B.title)) aiStart = Date.now(); return aiResp({}, 3000)(b); };
  const app = await openApp({ cfg: { selectedBikes: TWO }, world: { detail: () => ({ desc: GOOD, images: 4 }), ai,
    search: (k) => { if (k === "slash") slashAt.push(Date.now()); return k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : []; } } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitUntil(() => aiStart != null, 15000, "start analizy");
    await app.waitUntil(() => slashAt.some(t => t > aiStart + 200 && t < aiStart + 2800), 6000, "wyszukiwanie w trakcie analizy");
    await app.waitUntil(() => deals(app.st).length >= 1, 30000, "okazja po wolnej analizie");
    await app.waitLog(/Wysłano na Discord: Canyon Torque CF Slow — .* · ⏱ .* od wykrycia/, 10000);
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

await test("STOP w trakcie analizy w tle → kończy oba przebiegi, oferta zostaje w kolejce", async () => {
  let phase = 1, aiStarted = false;
  const B = { id: "2000000632", title: "Canyon Torque CF Stop", price: 900 };
  const ai = (b) => { if (!b.action && promptOf(b).includes(B.title)) aiStarted = true; return aiResp({}, 5000)(b); };
  const app = await openApp({ world: { detail: () => ({ desc: GOOD, images: 4 }), ai, search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitUntil(() => aiStarted, 15000, "start analizy");
    const t0 = Date.now();
    await app.stop();
    await app.waitStopped(4000);
    assert.ok(Date.now() - t0 < 4000, "STOP nie czeka na koniec analizy");
    const pending = JSON.parse(await app.ls("ddf_pending"));
    assert.ok(pending.some(j => j.listing.listingId === B.id), "oferta w kolejce");
    assert.equal(deals(app.st).length, 0);
  } finally { await app.close(); }
});

await test("Priorytet: oferta czekająca > 15 min idzie przed nowszą pewną", async () => {
  const job = (id, title, ageMin, groqType) => ({ listing: { listingId: id, title, price: 900, href: HREF(id), desc: "", bike: "Canyon Torque" },
    source: "new", stage: "analyze", groqType, attempts: 0, addedAt: Date.now() - ageMin * 60e3, nextAttemptAt: 0 });
  const app = await openApp({ ls: { ddf_pending: [job("2000000633", "Canyon Torque Nowa Pewna", 1, "full"), job("2000000634", "Canyon Torque Stara Niepewna", 30, "niepewne")] },
    world: { search: () => [A], detail: () => ({ desc: GOOD, images: 2 }), ai: aiResp({ decyzja: "nie", szacowana_sprzedaz_eur: 950 }) } });
  try {
    await app.start();
    await app.waitUntil(() => genReqs(app.st).filter(b => !isVer(b)).length >= 2, 20000, "obie analizy");
    const first = genReqs(app.st).find(b => !isVer(b));
    assert.ok(promptOf(first).includes("Canyon Torque Stara Niepewna"), "najpierw najdłużej czekająca");
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

await test("Rotacja: każdy cykl zaczyna od innego wyszukiwania; linki modeli z zakresem cen", async () => {
  const urls = [];
  const app = await openApp({ cfg: { selectedBikes: TWO }, world: { search: (k, n, st, url) => { urls.push(url); return k === "torque" ? [A] : []; } } });
  try {
    await app.start();
    const line = await app.waitLog(/Cykl #1 — sprawdzam \d+ wyszukiwań/);
    const n = Number(line.match(/sprawdzam (\d+)/)[1]);
    await app.waitLog(/Cykl #3 zakończony/, 20000);
    assert.ok(n >= 2);
    const firsts = [urls[0], urls[n], urls[2 * n]];
    assert.notEqual(firsts[0], firsts[1], "cykl 2 zaczyna od innego wyszukiwania");
    assert.notEqual(firsts[1], firsts[2], "cykl 3 też");
    assert.ok(urls.some(u => u.includes("/s-fahrraeder/preis:200:1400/Canyon%20Torque/") || u.includes("/s-fahrraeder/preis:200:1400/Canyon Torque/")), urls.find(u => /Torque/.test(u)));
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

await test("Koniec cyklu: stan kolejki analiz i średni czas od wykrycia do alertu", async () => {
  let phase = 1;
  const B = { id: "2000000635", title: "Canyon Torque CF Delay", price: 900 };
  const app = await openApp({ world: { detail: () => ({ desc: GOOD, images: 4 }), ai: aiResp({}, 1500), search: (k) => k === "torque" ? [A, ...(phase >= 2 ? [B] : [])] : [] } });
  try {
    await app.start(); await app.waitLog(/Cykl #1 zakończony/); phase = 2;
    await app.waitLog(/W kolejce do analizy AI: 1 \(najdłużej czeka .*\) · analizy trwają w tle/, 15000);
    await app.waitUntil(() => deals(app.st).length >= 1, 20000, "okazja");
    await app.waitLog(/Cykl #\d+ zakończony .* · średnio .* od wykrycia do alertu \(ostatnie 1\)/, 15000);
  } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
});

for (const r of results) console.log(r);
await closeBrowser();
if (results.some(r => r.startsWith("❌"))) process.exit(1);
