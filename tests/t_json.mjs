// v6.3: naprawa typowych błędów składni JSON w odpowiedziach modeli (repairJsonText z public/index.html)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const m = src.match(/const repairJsonText = \(src\) => \{[\s\S]*?\n\};/);
assert.ok(m, "repairJsonText w index.html");
const repairJsonText = new Function(`return (${m[0].replace("const repairJsonText = ", "").replace(/;$/, "")})`)();
const cases = [
  ["cudzysłów cala w tekście", '{\n  "tytul": "Trek Slash 7 27,5" Laufräder",\n  "zysk": 100\n}', { tytul: 'Trek Slash 7 27,5" Laufräder', zysk: 100 }],
  ["cudzysłów na końcu tekstu", '{\n  "a": "Rahmen 29"",\n  "b": 2\n}', { a: 'Rahmen 29"', b: 2 }],
  ["brak przecinka + przecinek przed ] i }", '{\n  "a": "x"\n  "b": [1, 2,],\n}', { a: "x", b: [1, 2] }],
  ["nowa linia w tekście", '{"a": "linia1\nlinia2", "b": true}', { a: "linia1\nlinia2", b: true }],
  ["brak przecinków po liczbie / obiekcie", '{\n  "a": 5\n  "b": {"c": "d"}\n  "e": null\n}', { a: 5, b: { c: "d" }, e: null }],
  ["poprawny JSON bez zmian", '{"ok": "z \\"cytatem\\"", "n": 1}', { ok: 'z "cytatem"', n: 1 }],
];
for (const [name, inp, exp] of cases) assert.deepEqual(JSON.parse(repairJsonText(inp)), exp, name);
console.log("JSON REPAIR TESTS OK");
