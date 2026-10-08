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
    const resp = await fetch(target.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "de-DE,de;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    let html = await resp.text();
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
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Prawdziwy status z Kleinanzeigen (np. 403/429 przy blokadzie, 404/410 dla usuniętego
    // ogłoszenia) — wcześniej zawsze było 200, więc aplikacja nie mogła wykryć blokady.
    return res.status(resp.status).send(html);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
