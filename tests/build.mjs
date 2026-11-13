// Przygotowanie testów: wyciąga skrypt aplikacji z public/index.html, kompiluje JSX (esbuild)
// i kopiuje api/*.js jako moduły .mjs (package.json projektu nie ma "type": "module").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(HERE, ".build");
fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const m = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/);
if (!m) throw new Error("Nie znaleziono <script type=\"text/babel\"> w public/index.html");
const esbuildMod = await import("esbuild").catch(() => import("/opt/npm-tools/node_modules/esbuild/lib/main.js"));
const esbuild = esbuildMod.default || esbuildMod;
const { code } = await esbuild.transform(m[1], { loader: "jsx" });
fs.writeFileSync(path.join(OUT, "app.js"), code);
fs.copyFileSync(path.join(ROOT, "api/gemini.js"), path.join(OUT, "gem.mjs"));
fs.copyFileSync(path.join(ROOT, "api/discord.js"), path.join(OUT, "disc.mjs"));
fs.copyFileSync(path.join(ROOT, "api/scrape.js"), path.join(OUT, "scr.mjs")); // v6.4
console.log("build OK →", OUT);
