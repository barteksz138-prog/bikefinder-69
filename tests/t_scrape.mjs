// v6.4: api/scrape.js — tylko kleinanzeigen.de, kontrola domeny po przekierowaniu, limit czasu i rozmiaru, przycinanie stron wyników
import assert from "node:assert/strict";
import handler from "./.build/scr.mjs";
const mkRes = () => { const r = { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, end() { return this; } }; return r; };
const call = async (url) => { const res = mkRes(); await handler({ method: "GET", query: { url } }, res); return res; };
let mock = null;
globalThis.fetch = async (u, opts) => mock(u, opts);

// obca domena — odrzucona bez pobierania
mock = () => { throw new Error("nie powinno pobierać"); };
assert.equal((await call("https://example.com/x")).code, 400);

// strona wyników — przycięta do kart
mock = async (u) => ({ ok: true, status: 200, url: u, text: async () => `<html><head>${"x".repeat(1000)}</head><body><nav>menu</nav><article data-adid="1">A</article><article data-adid="2">B</article><footer>f</footer></body></html>` });
let r = await call("https://www.kleinanzeigen.de/s-fahrraeder/anzeige:angebote/preis:200:1400/dirt/k0c217");
assert.equal(r.code, 200);
assert.ok(r.body.includes('<article data-adid="1">') && !r.body.includes("<nav>") && !r.body.includes("footer"));

// krótki adres ogłoszenia → przekierowanie w obrębie kleinanzeigen.de — OK, prawdziwy status
mock = async () => ({ ok: true, status: 200, url: "https://www.kleinanzeigen.de/s-anzeige/rad/3569543906-217-7615", text: async () => "<html><h1 id=\"viewad-title\">Rad</h1></html>" });
r = await call("https://www.kleinanzeigen.de/s-anzeige/3569543906");
assert.equal(r.code, 200);

// przekierowanie poza kleinanzeigen.de → 502
mock = async () => ({ ok: true, status: 200, url: "https://evil.example/landing", text: async () => "<html>x</html>" });
r = await call("https://www.kleinanzeigen.de/s-anzeige/123");
assert.equal(r.code, 502);

// za duża odpowiedź → 502
mock = async (u) => ({ ok: true, status: 200, url: u, text: async () => "x".repeat(4_000_001) });
r = await call("https://www.kleinanzeigen.de/s-anzeige/123");
assert.equal(r.code, 502);

// limit czasu → 504
mock = async () => { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; };
r = await call("https://www.kleinanzeigen.de/s-anzeige/123");
assert.equal(r.code, 504);

// blokada — prawdziwy status 403 przekazany dalej
mock = async (u) => ({ ok: false, status: 403, url: u, text: async () => "blocked" });
r = await call("https://www.kleinanzeigen.de/s-fahrraeder/dirt/k0c217");
assert.equal(r.code, 403);
console.log("SCRAPE TESTS OK");
