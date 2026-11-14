// v6.6: cena z opisu — wyszukiwanie kwot i sprawdzanie kwoty wskazanej przez AI (blok ==DESCPRICE_START== … ==DESCPRICE_END==)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const m = src.match(/\/\/ ==DESCPRICE_START==[\s\S]*?\/\/ ==DESCPRICE_END==/);
assert.ok(m, "blok DESCPRICE w index.html");
const { findDescPrices, validateDescPrice, normalizeDescPrice } = new Function(`${m[0]}\nreturn { findDescPrices, validateDescPrice, normalizeDescPrice };`)();

// Prawdziwy opis Spectrala CF (13.11.2026): cena w ogłoszeniu 1299 €
const SPECTRAL = "Rahmengröße MDer Preis ist im gewissen Maße verhandelbar, aber bitte nur ernsthafte AngeboteGerne auch gleichwertige tauschangeboteDieses Wochenende 1000€";
assert.deepEqual(findDescPrices(SPECTRAL), [1000]);
assert.deepEqual(validateDescPrice(1000, 1299, SPECTRAL), { ok: true });

const has = (t, v) => findDescPrices(t).includes(v);
assert.ok(has("Nur diese Woche: 1.000 € Festpreis", 1000), "1.000 €");
assert.ok(has("Bei sofortiger Abholung 900,- €", 900), "900,- €");
assert.ok(has("Schmerzgrenze 950 Euro", 950), "Euro");
assert.ok(has("letzter Preis 850", 850), "Preis bez €");
assert.ok(has("Diese Woche für EUR 1100", 1100), "EUR przed kwotą");
assert.ok(!has("Neupreis 3000€, jetzt günstig", 3000), "cena nowego");
assert.ok(!has("Neupreis lag damals bei 2500 €", 2500), "cena nowego z wypełniaczami");
assert.ok(!has("UVP: 4.199 €", 4199), "UVP");
assert.ok(!has("Neue Laufräder für 400€ verbaut", 400), "części");
assert.ok(!has("Gabel 600 € neu", 600), "widelec");
assert.ok(!has("Versand 50€ möglich, gefahren für 1000 km", 1000), "kilometry");
assert.ok(!has("Akku 625 Wh, nur 1200 km", 1200), "km bez €");

// Sprawdzenie kwoty wskazanej przez AI
const T = "Propain Rage(‼️1400€‼️NUR DIESE WOCHE) — guter Zustand";
assert.equal(validateDescPrice(1400, 1400, T).ok, false, "równa cenie ogłoszenia");
assert.match(validateDescPrice(900, 1299, SPECTRAL).reason, /nie ma w opisie/, "kwota spoza tekstu");
assert.match(validateDescPrice(500, 1299, "Nur heute 500€").reason, /mniej niż 50%/, "za niska — raczej coś innego");
assert.equal(validateDescPrice(1000, null, SPECTRAL).ok, false, "brak ceny ogłoszenia");
assert.deepEqual(normalizeDescPrice({ eur: "1000", warunek: " tylko w ten weekend " }), { eur: 1000, warunek: "tylko w ten weekend" });
assert.equal(normalizeDescPrice({ eur: null, warunek: "x" }), null);
assert.equal(normalizeDescPrice("1000"), null);
assert.deepEqual(normalizeDescPrice({ eur: 999.6, warunek: "null" }), { eur: 1000, warunek: null });
console.log("DESC PRICE TESTS OK");
