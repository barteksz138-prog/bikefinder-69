import { openApp, closeBrowser, contentKeyOf } from "./harness.mjs";
import assert from "node:assert/strict";
const A = { id: "1000000001", title: "Canyon Torque AL alt", price: 1000 };
const href = "https://www.kleinanzeigen.de/s-anzeige/x/2000000002-217-1234";
const GOOD = "Sehr gepflegtes Canyon Torque, Fox 38, SRAM GX, Größe L, regelmäßig gewartet, Rechnung vorhanden. Abholung.";
const results = [];
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { results.push(`❌ ${name}: ${e.message}`); } }
const oldDeal = (extra = {}) => ({ ddf_scan_state: { searches: {} }, ddf_outbox: [{ id: "o1", kind: "deal",
  listing: { listingId: href, title: "Canyon Torque AL 6 2021", price: 700, href },
  analysis: { typ_roweru: "full", przewidywany_zysk: 630, transport_eur: 70, cena_zakupu_eur: 700, szacowana_sprzedaz_eur: 1400, krotki_opis: "Zakup 700€ → 1400€", fakty: {} },
  contentKey: contentKeyOf({ title: "Canyon Torque AL 6 2021", desc: GOOD }), // v6.1: bez odcisku zaległa okazja idzie do ponownej analizy
  addedAt: Date.now() - 2 * 3600e3, tries: 1, ...extra }] });
const run = async (detail, check) => {
  const app = await openApp({ ls: oldDeal(), world: { search: () => [A], detail, ai: () => ({}) } });
  await app.start();
  try { await check(app); } finally { await app.stop().catch(() => {}); await app.waitStopped().catch(() => {}); await app.close(); }
};

await test("Zaległa okazja: cena 700 → 1500 € → do niepewnych, bez alertu okazji", () => run(() => ({ desc: GOOD, price: 1500 }), async (app) => {
  await app.waitLog(/Zaległa okazja → do niepewnych \(cena zmieniła się 700€ → 1500€/);
  await app.waitUntil(() => app.st.discord.some(d => d.webhookUrl.includes("/2/")), 15000, "lista niepewnych");
  assert.ok(!app.st.discord.some(d => d.payload.embeds), "bez wiadomości OKAZJA");
}));

await test("Zaległa okazja: cena 700 → 750 € → zysk przeliczony (580 €) i wysłana", () => run(() => ({ desc: GOOD, price: 750 }), async (app) => {
  await app.waitUntil(() => app.st.discord.some(d => d.payload.embeds), 15000, "okazja");
  const e = app.st.discord.find(d => d.payload.embeds).payload.embeds[0];
  assert.equal(e.fields.find(f => f.name.includes("zysk")).value, "**~580€** (po transporcie 70€)");
  assert.ok(e.description?.includes("700€ → 750€") || JSON.stringify(e).includes("700€ → 750€"));
}));

await test("Zaległa okazja: blokada przy sprawdzaniu → nie wysłana, czeka", () => run(() => ({ status: 403 }), async (app) => {
  await app.waitLog(/Zaległa okazja czeka — nie udało się sprawdzić ogłoszenia/);
  await app.waitLog(/Cykl #1 zakończony/);
  assert.equal(app.st.discord.length, 0);
  const ob = JSON.parse(await app.ls("ddf_outbox"));
  assert.equal(ob.length, 1); assert.ok(ob[0].refreshFailedSince > 0);
}));

await test("Zaległa okazja: ceny nie da się odczytać → v5.11: czeka (nie usunięta, nie wysłana)", () => run(() => ({ desc: GOOD }), async (app) => {
  await app.waitLog(/Zaległa okazja czeka — nie udało się sprawdzić ogłoszenia \(nie udało się odczytać ceny/);
  await app.waitLog(/Cykl #1 zakończony/);
  assert.equal(app.st.discord.length, 0);
  assert.equal(JSON.parse(await app.ls("ddf_outbox")).length, 1);
}));

await test("Zaległa okazja: ta sama cena → wysłana bez zmian", () => run(() => ({ desc: GOOD, price: 700 }), async (app) => {
  await app.waitUntil(() => app.st.discord.some(d => d.payload.embeds), 15000, "okazja");
  assert.equal(app.st.discord[0].payload.embeds[0].fields.find(f => f.name.includes("zysk")).value, "**~630€** (po transporcie 70€)");
}));

await closeBrowser();
console.log(results.join("\n"));
process.exit(results.some(r => r.startsWith("❌")) ? 1 : 0);
