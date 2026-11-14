// v6.7: ściąga generacji ram dla weryfikatora — wybór ściągi po tytule / nazwie wyszukiwania (blok ==GENSHEET_START== … ==GENSHEET_END==)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const m = src.match(/\/\/ ==GENSHEET_START==[\s\S]*?\/\/ ==GENSHEET_END==/);
assert.ok(m, "blok GENSHEET w index.html");
const KB_BRAND_PATTERNS = { trek: /\btrek\b/i, canyon: /\bcanyon\b/i, specialized: /\bspecialized\b/i, yt: /\byt\b/i, santa_cruz: /santa\s*cruz/i, commencal: /commencal/i };
const { genSheetFor, GEN_SHEETS } = new Function("KB_BRAND_PATTERNS", `${m[0]}\nreturn { genSheetFor, GEN_SHEETS };`)(KB_BRAND_PATTERNS);
const nm = (t, l = "") => genSheetFor(t, l)?.name ?? null;
assert.equal(GEN_SHEETS.length, 9);
const cases = [
  ["Trek Slash 7 Gen 5 (2021) 29\"", "Trek Slash"], ["Trek Slash 9.9 29 enduro 2017", "Trek Slash"],
  ["Specialized Enduro Elite 2018 | Carbon", "Specialized Enduro"], ["S-Works Enduro 29", "Specialized Enduro"],
  ["Specialized Stumpjumper Alloy 2021", "Specialized Stumpjumper"], ["Specialized Stumpjumper Enduro-Fully", "Specialized Stumpjumper"],
  ["Canyon Torque CF 9.0 Size M 2018", "Canyon Torque"], ["Canyon Torque:ON 7 E-Mountainbike", null], ["Canyon Torque ON 9", null],
  ["YT Capra Base 29 2022", "YT Capra"], ["Santa Cruz Bronson C 2024", "Santa Cruz Bronson"], ["Santa Cruz Nomad CC 2019", "Santa Cruz Nomad"],
  ["Commencal Meta AM 29 Gr. M 2022", "Commencal Meta"], ["Commencal Meta HT 24 Zoll", null], ["Commencal Meta Power SX", null],
  ["Canyon Spectral CF 7", "Canyon Spectral"], ["Canyon Spectral:ON CF 7", null], ["Canyon Spectral 125 AL 6", null],
  ["Trek Remedy 8 2019", null], ["Fully Enduro 27,5 Zoll", null], ["Cube Stereo 160", null],
];
for (const [t, exp] of cases) assert.equal(nm(t), exp, t);
// nazwa wyszukiwania tylko, gdy tytuł nie wymienia żadnej marki
assert.equal(nm("Enduro Fully 29 Gr. L", "Trek Slash"), "Trek Slash");
assert.equal(nm("Canyon Strive CF 8", "Canyon Torque"), null, "inny model tej samej marki");
assert.equal(nm("Trek Fuel EX 8", "Trek Slash"), null);
for (const g of GEN_SHEETS) assert.ok(g.text.split("\n").length >= 2 && /\d{4}/.test(g.text), `ściąga ${g.name}`);
console.log("GEN SHEET TESTS OK");
