// v6.5: materiał ramy z tekstu ogłoszenia + decyzja, który materiał liczy program (blok ==FRAME_START== … ==FRAME_END== z public/index.html)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const m = src.match(/\/\/ ==FRAME_START==[\s\S]*?\/\/ ==FRAME_END==/);
assert.ok(m, "blok FRAME w index.html");
const { detectFrameMaterialText, normalizeFrame, resolveFrameMaterial } = new Function(`${m[0]}\nreturn { detectFrameMaterialText, normalizeFrame, resolveFrameMaterial };`)();
const mat = (t, d = "") => detectFrameMaterialText(t, d).material;

// Tytuły z testu na żywo (11.2026) — materiał podany przez sprzedawcę
const titles = [
  ["YT Capra Carbon Mountainbike 27,5 Zoll L", "karbon"], ["MTB / Enduro YT Capra Carbon Größe M", "karbon"],
  ["Canyon Spectral cf 7", "karbon"], ["Canyon Spectral CF 9.0  Carbon Fully MTB – inkl. Rechnung", "karbon"],
  ["Cube Stereo HPC Race Carbon Fully Gr.L 27,5\" Top Z", "karbon"], ["CUBE Stereo 140 HPC SL Carbon – Modelljahr 2022", "karbon"],
  ["Giant Trance Advanced Carbon 2018", "karbon"], ["Giant Trance X Advanced Pro 2 29\" MTB Fully", "karbon"],
  ["Trek Fuel EX 9.8 Carbon Mountainbike 27,5 Zoll", "karbon"], ["YT Capra Blaze XL Carbon 29 | FOX Factory | MT7 | Carbonräder", "karbon"],
  ["YT Capra AL 29 – Größe L – FOX Fahrwerk – Magura MT7", "alu"], ["YT Capra Al M 27.5 Enduro Mtb", "alu"], ["YT Capra Industries Base AL", "alu"],
  ["Canyon Spectral Al", "alu"], ["Canyon Spectral AL 6.0", "alu"], ["Cube Stereo 140 HPA Mountainbike, 20\" (L)", "alu"],
  ["Cube Stereo 160 HPA SL 27.5 Mountainbike, Enduro-Fully", "alu"], ["TREK FUEL EX 9  Fully mit Carbon Lenker +Alu Rahmen RH 47 cm", "alu"],
  ["Canyon Torque AL 5.0 2019", "alu"], ["Specialized Stumpjumper Alloy Comp", "alu"], ["Santa Cruz Nomad CC 2019", "karbon"],
  ["Santa Cruz Bronson C R 2020", "karbon"], ["Santa Cruz Nomad A 2018", "alu"], ["Specialized S-Works Enduro", "karbon"],
  ["Cube Stereo 150 C:62 Race", "karbon"], ["Giant Reign 2 ALUXX", "alu"], ["Trek Remedy 8 Alpha Gold", "alu"],
  ["YT Capra Comp 2020", null], ["Canyon Torque 2021 Fully Enduro", null], ["Trek Slash mit Carbonlaufrädern", null],
  ["Fully mit Alu-Felgen und Carbon-Lenker", null], ["Commencal Clash All Mountain", null], ["Canyon Spectral CF 7 Carbon – AL 5 Komponenten", null],
];
for (const [t, exp] of titles) assert.equal(mat(t), exp, `tytuł: ${t}`);
assert.equal(detectFrameMaterialText("Canyon Spectral CF 7 Carbon – AL 5 Komponenten", "").conflict, true, "sprzeczny tytuł");

// Opis rozstrzyga, gdy tytuł milczy; tytuł wygrywa z opisem; podzespoły i tył ramy nie liczą się
assert.equal(mat("YT Capra 27,5", "Verkaufe meine YT Capra mit Alu-Rahmen, Fox 36."), "alu");
assert.equal(mat("YT Capra 27,5", "Rahmen aus Carbon, sehr leicht."), "karbon");
assert.equal(mat("Cube Stereo 140", "All-Mountain-Fully mit Carbon-Hauptrahmen und Aluminium-Hinterbau."), "karbon");
assert.equal(mat("Canyon Torque", "Neue Carbon Laufräder, Lenker aus Carbon, Alu Pedale."), null);
assert.equal(mat("YT Capra AL", "Verbaut sind Carbonfelgen und ein Carbon Lenker."), "alu");
assert.equal(mat("Canyon Spectral", "Das Rad ist al dente gepflegt, alle Teile original."), null, "małe „al” w opisie to nie AL");
assert.equal(mat("Canyon Spectral", "Canyon Spectral AL 6.0 aus 2019."), "alu");
assert.equal(mat("Radon Swoop", "Kohlefaser-Rahmen, 170 mm."), "karbon");
assert.equal(mat("Canyon Torque", "Laufradsatz Alu, Carbongabel? nein, Fox 38."), null, "laufradsatz / gabel to podzespoły");
assert.equal(detectFrameMaterialText("YT Capra Al M 27.5", "").evidence, "tytuł: „Al”");

// Który materiał liczy program
const T = (material) => ({ material, conflict: false, evidence: null });
const R = (o) => normalizeFrame(o);
let r = resolveFrameMaterial(T("alu"), R({ material: "karbon", zrodlo: "wyglad", sprzedaz_alu_eur: 1000 }), 1300);
assert.deepEqual([r.final, r.priceAsAlu, r.saleAlu, r.possibleCarbon], ["alu", true, 1000, false], "tekst „AL” wygrywa z wyglądem już w pierwszej analizie");
r = resolveFrameMaterial(T(null), R({ material: "karbon", zrodlo: "wyglad", sprzedaz_alu_eur: 1000 }), 1300);
assert.deepEqual([r.final, r.priceAsAlu, r.saleAlu, r.possibleCarbon], ["karbon", false, 1000, true], "karbon z wyglądu zostaje karbonem, wycena alu do alertu");
r = resolveFrameMaterial(T(null), R({ material: "karbon", zrodlo: "wyglad", sprzedaz_alu_eur: null }), 1300);
assert.deepEqual([r.final, r.priceAsAlu, r.saleAlu, r.possibleCarbon], ["karbon", false, 1040, true], "bez wyceny alu: 80% wyceny karbonu");
r = resolveFrameMaterial(T(null), R({ material: "karbon", zrodlo: "napis", sprzedaz_alu_eur: 1000 }), 1300);
assert.deepEqual([r.final, r.priceAsAlu, r.source], ["karbon", false, "napis"], "czytelny napis = karbon");
r = resolveFrameMaterial(T("karbon"), R({ material: "alu", zrodlo: "napis" }), 1100);
assert.equal(r.final, "alu"); assert.match(r.warn, /napis na ramie wskazuje alu/);
r = resolveFrameMaterial(T("alu"), R({ material: "karbon", zrodlo: "napis", sprzedaz_alu_eur: 1500 }), 1300);
assert.deepEqual([r.final, r.saleAlu], ["alu", 1040], "wycena alu wyższa od karbonu → 80%"); assert.match(r.warn, /napis na ramie wskazuje karbon/);
r = resolveFrameMaterial(T(null), R({ material: "alu", zrodlo: "wyglad" }), 1100);
assert.deepEqual([r.final, r.priceAsAlu, r.possibleCarbon], ["alu", false, false]);
r = resolveFrameMaterial(T(null), R(null), 1100);
assert.deepEqual([r.final, r.priceAsAlu, r.source], ["nie_wiem", false, "nieznany"], "brak pola rama");
assert.deepEqual(R({ material: "karbon", zrodlo: "zdjecie", dowod: "null", sprzedaz_alu_eur: "1050" }), { material: "karbon", zrodlo: "nieznany", dowod: null, sprzedaz_alu_eur: 1050 });
console.log("FRAME MATERIAL TESTS OK");
