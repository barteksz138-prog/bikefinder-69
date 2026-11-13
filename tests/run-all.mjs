// Uruchamia wszystkie testy po kolei: node tests/run-all.mjs  (albo jeden plik: node tests/run-all.mjs tests512.mjs)
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(HERE, "build.mjs")], { stdio: "inherit" });
const ALL = ["tests56.mjs", "tests56b.mjs", "tests57.mjs", "tests58.mjs", "tests59.mjs", "tests510.mjs", "tests511.mjs", "tests512.mjs", "tests513.mjs", "tests514.mjs", "tests515.mjs", "tests600.mjs", "tests610.mjs", "tests620.mjs", "tests630.mjs", "tests640.mjs", "tests650.mjs",
  "t_api.mjs", "t_img.mjs", "t_disc.mjs", "t_chat.mjs", "t_json.mjs", "t_scrape.mjs", "t_frame.mjs"];
const files = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { encoding: "utf8", timeout: 15 * 60 * 1000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const lines = out.split("\n").filter(l => /^(✅|❌)|OK$|Error|assert/i.test(l) && !/^PAGEERROR/.test(l));
  const bad = r.status !== 0 || lines.some(l => l.startsWith("❌"));
  if (bad) failed++;
  console.log(`${bad ? "❌" : "✅"} ${f}`);
  for (const l of lines) if (bad || l.startsWith("❌")) console.log("   " + l);
}
console.log(failed ? `\n${failed} plik(ów) z błędami` : "\nWszystkie testy przeszły");
process.exit(failed ? 1 : 0);
