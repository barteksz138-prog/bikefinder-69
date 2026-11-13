import path from "node:path";
import { fileURLToPath } from "node:url";
// Playwright: zainstalowany normalnie ("playwright") albo w środowisku Claude (/opt/npm-tools)
const pw = await import("playwright").then(m => m.default || m).catch(() => import("/opt/npm-tools/node_modules/playwright/index.js").then(m => m.default || m));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const { chromium } = pw;
import fs from "node:fs";

export const IMG = (n, set = "ab") => `https://img.kleinanzeigen.de/api/v1/prod-ads/images/${set}/1234567${n}-1234-1234-1234-123456789abc?rule=$_59.JPG`;
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
export const card = (l) => `<article class="aditem" data-adid="${l.id}"><a href="/s-anzeige/x/${l.id}-217-1234">${esc(l.title)}</a><div class="aditem-main--top--left">10115 Berlin</div>${l.date ? `<div class="aditem-main--top--right"><i class="icon"></i> ${esc(l.date)}</div>` : ""}<h2>${esc(l.title)}</h2><p class="aditem-main--middle--description">${esc(l.desc || "Gepflegtes Bike")}</p><p class="aditem-main--middle--price-shipping--price">${l.price} €</p></article>`;
export const detailHtml = (d) => { const n = d.images ?? 2, set = d.imgSet || "ab"; const gal = Array.from({ length: Math.max(0, n - 1) }, (_, i) => `<div class="galleryimage-element"><img src="${IMG(i + 2, set)}"></div>`).join(""); return `<html><head>${n > 0 ? `<meta property="og:image" content="${IMG(1, set)}">` : ""}</head><body>${d.title ? `<h1 id="viewad-title">${esc(d.title)}</h1>` : ""}${d.seller ? `<div id="viewad-contact"><a href="/s-bestandsliste.html?userId=${d.seller}">Alle Anzeigen</a></div>` : ""}<div id="viewad-description-text">${esc(d.desc)}</div>${gal}${d.foreign ? `<section class="recommendations"><img src="${IMG(9)}"></section><img src="${IMG(8)}">` : ""}${d.price ? `<h2 id="viewad-price">${d.price} €</h2>` : ""}</body></html>`; };
// v6.1: ten sam odcisk treści co contentKey(l, false) w aplikacji (tytuł + opis + zdjęcia ze strony ogłoszenia z detailHtml)
export const hashStr = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
export const normTitle = (t) => String(t || "").toLowerCase().replace(/^\s*(reserviert|gelöscht)\s*[•·|-]\s*/g, "").replace(/[^a-z0-9äöüß]+/g, " ").trim();
export const contentKeyOf = ({ title, desc, images = 2 }) => hashStr(`${normTitle(title)}||${String(desc).replace(/[ \t]+/g, " ").trim()}|${Array.from({ length: images }, (_, i) => IMG(i + 1)).join(",")}`);
export const analysisJson = (o = {}) => JSON.stringify({
  typ_roweru: "full", decyzja: "tak", niepewne_kategoria: null, cena_zakupu_eur: 900, szacowana_sprzedaz_eur: 1500, przewidywany_zysk: 600, oplaca_sie: true,
  fakty: { rocznik: 2021, rocznik_zrodlo: "podany", e_bike: false, sprzedawca: "prywatny", stan: "uzywany", cena_nowego_eur: null, kompletny_rower: true },
  powod_decyzji: "test", krotki_opis: "Test", zdjecia: "Rama alu", ...o });
export const geminiResp = (text, extra = {}) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 9000, cachedContentTokenCount: 0, candidatesTokenCount: 800, thoughtsTokenCount: 0 }, ...extra });
export const groqResp = (typ) => ({ choices: [{ message: { content: `powód testowy\n${typ}` }, finish_reason: "stop" }] });

const html0 = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(HERE, ".build/app.js"), "utf8").replace("const sleep = (ms) => new Promise((r) => setTimeout(r, ms));", "const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5)));");
if (!appJs.includes("Math.min(ms, 5)")) throw new Error("sleep patch failed");
const html = html0.replace(/<script type="text\/babel"[^>]*>[\s\S]*?<\/script>/, () => `<script>${appJs}</script>`);
const shim = fs.readFileSync(path.join(HERE, "react-shim.js"), "utf8");

let browser;
// v6.2: adres app.localhost jest „bezpieczny” dla przeglądarki (jak https) — potrzebne do Web Locks (blokada jednej karty)
export const getBrowser = async () => (browser ||= await chromium.launch());
export const closeBrowser = async () => { if (browser) await browser.close(); };

// world: { search(bikeKey, n, st) -> [cards], detail(id, st) -> {desc, price?} | {status}, ai(body, st) -> json | {status, json}, discord(body, st) -> {ok,status,...} }
export async function openApp({ cfg = {}, ls = {}, world, keepContext }) {
  const b = await getBrowser();
  const ctx = keepContext || await b.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  const st = { searchCalls: {}, aiReqs: [], discord: [], detailCalls: [], errors: [], groqReqs: [], cardPrices: {} };
  page.on("pageerror", e => { st.errors.push(e.message); console.log("PAGEERROR", e.message); });
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes("cdnjs") && url.includes("react") && !url.includes("react-dom")) return route.fulfill({ body: shim, contentType: "text/javascript" });
    if (url.includes("cdnjs")) return route.fulfill({ body: "", contentType: "text/javascript" });
    if (url === "http://app.localhost/") return route.fulfill({ body: html, contentType: "text/html" });
    if (url.startsWith("http://app.localhost/api/scrape")) {
      const target = decodeURIComponent(new URL(url).searchParams.get("url"));
      if (target.includes("/s-anzeige/")) {
        const id = (target.match(/\/(\d{7,})(?:-|$)/) || [])[1]; // v6.4: także krótki adres /s-anzeige/<numer> (nocne sprawdzanie cen)
        st.detailCalls.push(id);
        const d = world.detail ? world.detail(id, st) : { desc: "Sehr gepflegtes Bike, Fox 38, SRAM GX, Größe L, regelmäßig gewartet, Rechnung vorhanden, kleine Kratzer am Rahmen, sonst top. Abholung." };
        if (d.status) return route.fulfill({ status: d.status, body: d.body || "", contentType: "text/html" });
        const withPrice = d.price === undefined && st.cardPrices[id] != null ? { ...d, price: st.cardPrices[id] } : d; // price: null → strona bez ceny
        return route.fulfill({ body: detailHtml(withPrice), contentType: "text/html" });
      }
      const key = /Trek%20Slash|Trek Slash/.test(target) ? "slash" : /Canyon%20Torque|Canyon Torque/.test(target) ? "torque" : "other";
      st.searchCalls[key] = (st.searchCalls[key] || 0) + 1;
      const cards = world.search(key, st.searchCalls[key], st, decodeURIComponent(target)); // v6.3: + adres wyszukiwania
      for (const c of cards) st.cardPrices[c.id] = c.price; // v5.14: strona ogłoszenia pokazuje tę samą cenę co karta (jak na prawdziwym Kleinanzeigen)
      return route.fulfill({ body: `<html><body>${cards.map(card).join("")}</body></html>`, contentType: "text/html" });
    }
    if (url.startsWith("http://app.localhost/api/gemini")) {
      const body = JSON.parse(req.postData());
      if (body.provider === "groq") { st.groqReqs.push(body); return route.fulfill({ contentType: "application/json", body: JSON.stringify(world.groq ? world.groq(body, st) : groqResp("full")) }); }
      st.aiReqs.push(body);
      const r = await world.ai(body, st);
      if (r && r.__delay) await new Promise(res => setTimeout(res, r.__delay));
      const json = r && r.__json !== undefined ? r.__json : r;
      return route.fulfill({ status: (r && r.__status) || 200, contentType: "application/json", body: JSON.stringify(json) }).catch(() => {});
    }
    if (url.startsWith("http://app.localhost/api/discord")) {
      const body = JSON.parse(req.postData());
      st.discord.push(body);
      const r = world.discord ? world.discord(body, st) : { ok: true, status: 204, retryAfter: null, error: null };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(r) });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  const fullCfg = { provider: "gemini", geminiModel: "gemini-2.5-flash", geminiKey: "AIza-test", discordWebhook: "https://discord.com/api/webhooks/1/x",
    uncertainWebhook: "https://discord.com/api/webhooks/2/y", selectedBikes: ["canyon_torque"], ...cfg };
  if (!keepContext) {
    await page.addInitScript(({ c, extra }) => {
      if (!sessionStorage.getItem("__init")) {
        sessionStorage.setItem("__init", "1");
        localStorage.clear();
        localStorage.setItem("ddf_cfg", JSON.stringify(c));
        for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      }
    }, { c: fullCfg, extra: ls });
  }
  await page.goto("http://app.localhost/");
  await page.waitForTimeout(300);
  const api = {
    page, st, ctx,
    text: () => page.evaluate(() => document.body.innerText),
    logs: async () => (await page.evaluate(() => document.body.innerText)).split("\n").filter(l => /^\d{1,2}:\d{2}:\d{2} /.test(l)),
    start: async () => { await page.getByRole("button", { name: /Start — skanuj/ }).click(); },
    stop: async () => { await page.getByRole("button", { name: "⏹ Stop", exact: true }).click(); },
    waitLog: async (re, timeout = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const l = await api.logs();
        const hit = l.find(x => re.test(x));
        if (hit) return hit;
        await page.waitForTimeout(100);
      }
      throw new Error("timeout waiting for log " + re);
    },
    countLogs: async (re) => (await api.logs()).filter(x => re.test(x)).length,
    waitUntil: async (fn, timeout = 15000, label = "condition") => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { if (await fn()) return true; await page.waitForTimeout(100); }
      throw new Error("timeout waiting for " + label);
    },
    waitStopped: async (timeout = 15000) => api.waitLog(/⏹ Zatrzymano/, timeout),
    ls: (k) => page.evaluate((k) => localStorage.getItem(k), k),
    // v6.3: analizy idą w tle — czekamy, aż kolejka będzie pusta i wykonawca AI nic nie robi
    waitQueueEmpty: async (timeout = 20000) => api.waitUntil(async () => {
      const p = JSON.parse((await page.evaluate(() => localStorage.getItem("ddf_pending"))) || "[]");
      return p.length === 0 && !(await page.evaluate(() => !!document.querySelector("[data-testid=ai-status]")));
    }, timeout, "pusta kolejka analiz"),
    close: async () => { await page.close(); if (!keepContext) await ctx.close(); },
  };
  return api;
}
