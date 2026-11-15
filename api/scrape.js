const SCRAPE_TIMEOUT_MS = 20000;      // v6.4
const SCRAPE_MAX_CHARS = 4_000_000;  // v6.4: strona wyników ~650 tys., ogłoszenia ~270 tys. znaków
const SCRAPE_MAX_REDIRECTS = 5;      // v6.11
const KA_HOSTS = ["www.kleinanzeigen.de", "kleinanzeigen.de"];
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Brak url" });

  // Tylko Kleinanzeigen — wcześniej proxy pobierało DOWOLNY adres, więc każdy, kto znał adres
  // aplikacji, mógł przez nią ściągać cokolwiek z internetu. Status 400 (nie 403!), żeby aplikacja
  // nie pomyliła odrzuconego linku z blokadą ze strony Kleinanzeigen.
  let target;
  try { target = new URL(url); } catch { return res.status(400).json({ error: "Niepoprawny url" }); }
  if (target.protocol !== "https:" || !["www.kleinanzeigen.de", "kleinanzeigen.de"].includes(target.hostname)) {
    return res.status(400).json({ error: "Dozwolone są tylko adresy kleinanzeigen.de" });
  }

  try {
    // v6.4: limit czasu (wisząca odpowiedź nie blokuje funkcji) i kontrola domeny po przekierowaniach
    // (krótki adres /s-anzeige/<numer> przekierowuje na pełny — zostaje w kleinanzeigen.de)
    // v6.11: przekierowania obsługujemy sami (redirect: "manual") i sprawdzamy host PRZED pójściem dalej —
    // wcześniej zapytanie do obcego hosta było już wysłane, zanim kod odrzucił odpowiedź.
    const signal = AbortSignal.timeout(SCRAPE_TIMEOUT_MS);
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "de-DE,de;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    let cur = target, resp;
    for (let hop = 0; ; hop++) {
      resp = await fetch(cur.toString(), { signal, headers, redirect: "manual" });
      const loc = resp.status >= 300 && resp.status < 400 ? resp.headers?.get?.("location") : null;
      if (!loc) break;
      if (hop >= SCRAPE_MAX_REDIRECTS) return res.status(502).json({ error: "Za dużo przekierowań" });
      let next;
      try { next = new URL(loc, cur); } catch { return res.status(502).json({ error: "Niepoprawne przekierowanie" }); }
      if (next.protocol !== "https:" || !KA_HOSTS.includes(next.hostname)) {
        return res.status(502).json({ error: `Przekierowanie poza kleinanzeigen.de (${next.hostname})` });
      }
      cur = next;
    }
    let finalHost = "";
    try { finalHost = new URL(resp.url || cur.toString()).hostname; } catch {}
    if (finalHost && !KA_HOSTS.includes(finalHost)) {
      return res.status(502).json({ error: `Przekierowanie poza kleinanzeigen.de (${finalHost})` });
    }
    let html = await resp.text();
    if (html.length > SCRAPE_MAX_CHARS) return res.status(502).json({ error: `Odpowiedź za duża (${html.length} znaków)` });
    // Strony WYNIKÓW wyszukiwania (/s-..., ale nie /s-anzeige/) ważą ~650 tys. znaków, a aplikacji
    // potrzebne są tylko karty ogłoszeń. Wycinamy fragment od pierwszego <article do ostatniego
    // </article> — mniej transferu z Vercela i szybsze parsowanie. Strony ogłoszeń oraz strony
    // bez kart (np. captcha — wtedy aplikacja musi zobaczyć całość) zwracamy bez zmian.
    const isSearchPage = target.pathname.startsWith("/s-") && !target.pathname.startsWith("/s-anzeige/");
    if (isSearchPage && resp.ok) {
      const start = html.indexOf("<article");
      const end = html.lastIndexOf("</article>");
      if (start !== -1 && end > start) {
        html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html.slice(start, end + "</article>".length)}</body></html>`;
      }
    }
    // v6.11: zwykły tekst + nosniff + sandbox — otwarty w przeglądarce adres /api/scrape?url=… nie uruchomi skryptów
    // Kleinanzeigen w domenie aplikacji (tam jest localStorage z kluczami API i webhookami). Aplikacja czyta treść przez text().
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    // Prawdziwy status z Kleinanzeigen (np. 403/429 przy blokadzie, 404/410 dla usuniętego
    // ogłoszenia) — wcześniej zawsze było 200, więc aplikacja nie mogła wykryć blokady.
    return res.status(resp.status).send(html);
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") return res.status(504).json({ error: `Kleinanzeigen nie odpowiedział w ${SCRAPE_TIMEOUT_MS / 1000} s` });
    res.status(500).json({ error: e.message });
  }
}
