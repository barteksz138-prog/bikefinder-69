// v6.7/v6.8: ściąga generacji ram dla weryfikatora — wybór ściągi po tytule / nazwie wyszukiwania (blok ==GENSHEET_START== … ==GENSHEET_END==)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const m = src.match(/\/\/ ==GENSHEET_START==[\s\S]*?\/\/ ==GENSHEET_END==/);
assert.ok(m, "blok GENSHEET w index.html");
const KB_BRAND_PATTERNS = { trek: /\btrek\b/i, canyon: /\bcanyon\b/i, specialized: /\bspecialized\b/i, yt: /\byt\b/i, santa_cruz: /santa\s*cruz/i, commencal: /commencal/i,
  cube: /\bcube\b/i, radon: /\bradon\b/i, ghost: /\bghost\b/i, propain: /\bpropain\b/i, giant: /\bgiant\b/i };
const { genSheetFor, GEN_SHEETS } = new Function("KB_BRAND_PATTERNS", `${m[0]}\nreturn { genSheetFor, GEN_SHEETS };`)(KB_BRAND_PATTERNS);
const nm = (t, l = "") => genSheetFor(t, l)?.name ?? null;
assert.equal(GEN_SHEETS.length, 30);
assert.equal(new Set(GEN_SHEETS.map(g => g.name)).size, 30, "nazwy ściąg unikalne");
const cases = [
  ["Trek Slash 7 Gen 5 (2021) 29\"", "Trek Slash"], ["Trek Slash 9.9 29 enduro 2017", "Trek Slash"],
  ["Specialized Enduro Elite 2018 | Carbon", "Specialized Enduro"], ["S-Works Enduro 29", "Specialized Enduro"],
  ["Specialized Stumpjumper Alloy 2021", "Specialized Stumpjumper"], ["Specialized Stumpjumper Enduro-Fully", "Specialized Stumpjumper"],
  ["Canyon Torque CF 9.0 Size M 2018", "Canyon Torque"], ["Canyon Torque:ON 7 E-Mountainbike", null], ["Canyon Torque ON 9", null],
  ["YT Capra Base 29 2022", "YT Capra"], ["Santa Cruz Bronson C 2024", "Santa Cruz Bronson"], ["Santa Cruz Nomad CC 2019", "Santa Cruz Nomad"],
  ["Commencal Meta AM 29 Gr. M 2022", "Commencal Meta"], ["Commencal Meta HT 24 Zoll", null], ["Commencal Meta Power SX", null],
  ["Canyon Spectral CF 7", "Canyon Spectral"], ["Canyon Spectral:ON CF 7", null], ["Canyon Spectral 125 AL 6", null],
  ["Fully Enduro 27,5 Zoll", null],
  // v6.8: partie 1–2
  ["Trek Remedy 8 2019", "Trek Remedy"], ["Cube Stereo 140 HPC Race", "Cube Stereo"], ["Cube Stereo Hybrid 140 HPC 750", null],
  ["CUBE AMS 100 C:68 TM 29", "Cube AMS"], ["Cube AMS Hybrid ONE44", null],
  ["Canyon Neuron AL 7.0", "Canyon Neuron"], ["Canyon Neuron:ON 8", null], ["Canyon Neuron:ONfly CF 7", null],
  ["Trek Fuel EX 9.8 Carbon", "Trek Fuel EX"], ["Trek Fuel EX-e 9.7", null], ["Trek Fuel+ EX 5", null],
  ["Canyon Strive CF 8.0", "Canyon Strive"], ["Canyon Strive:ON CFR", null], ["Trek Session 8 29", "Trek Session"], ["Downhill Session Bike", null],
  ["Radon Swoop 10.0 HD", "Radon Swoop"], ["Radon Slide Trail 9.0", "Radon Slide"], ["Slide Trail Fully", null],
  ["Ghost Riot AM Full Party", "Ghost Riot"], ["Ghost E-Riot AM", null], ["Ghost Path Riot Advanced", null],
  ["Propain Tyee AL 29", "Propain Tyee"], ["YT Jeffsy Core 2", "YT Jeffsy"], ["YT Tues 27,5 AL", "YT Tues"],
  ["Specialized Demo 8 Alloy", "Specialized Demo"], ["Demo Bike Fully", null], ["Propain Rage CF", "Propain Rage"], ["Rage Fully", null],
  ["Propain Spindrift AL 27,5", "Propain Spindrift"], ["Santa Cruz Hightower CC", "Santa Cruz Hightower"], ["Santa Cruz Megatower C", "Santa Cruz Megatower"],
  ["Santa Cruz 5010 C S", "Santa Cruz 5010"], ["Commencal Supreme DH V5", "Commencal Supreme"], ["Supreme Hoodie", null],
  ["Giant Trance X 29 2", "Giant Trance"], ["Giant Trance X E+ 1", null],
];
for (const [t, exp] of cases) assert.equal(nm(t), exp, t);
// nazwa wyszukiwania tylko, gdy tytuł nie wymienia żadnej marki
assert.equal(nm("Enduro Fully 29 Gr. L", "Trek Slash"), "Trek Slash");
assert.equal(nm("Canyon Grand Canyon AL", "Canyon Torque"), null, "inny model tej samej marki");
assert.equal(nm("Radon Jab 10.0", "Radon Swoop"), null);
assert.equal(nm("Enduro Fully Carbon 29", "Propain Rage"), "Propain Rage", "Rage z nazwy wyszukiwania");
assert.equal(nm("Trek Fuel EX 8", "Trek Slash"), "Trek Fuel EX", "ściąga z tytułu, nie z wyszukiwania");
for (const g of GEN_SHEETS) assert.ok(!/^Kolory: brak pewnych danych/m.test(g.text) && g.text.split("\n").length >= 2 && /\d{4}/.test(g.text), `ściąga ${g.name}`);
// kolory dopisane do starych ściąg (Bronson i Nomad bez danych)
for (const n of ["Specialized Stumpjumper","Specialized Enduro","Trek Slash","Canyon Torque","YT Capra","Commencal Meta","Canyon Spectral"])
  assert.ok(/Kolory \(pomocniczo/.test(GEN_SHEETS.find(g => g.name === n).text), `kolory ${n}`);
console.log("GEN SHEET TESTS OK");
