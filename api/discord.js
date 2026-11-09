// Proxy do webhooków Discorda. Zawsze odpowiada JSON-em { ok, status, retryAfter, error }:
// ok=true tylko wtedy, gdy Discord potwierdził przyjęcie wiadomości. Przy odmowie (np. 401/403/404 — zły
// lub usunięty webhook, 429 — limit wiadomości) aplikacja dostaje kod i czas, po którym można ponowić.
const MAX_PAYLOAD_CHARS = 20000; // embed + treść wiadomości mieszczą się z dużym zapasem
const DISCORD_TIMEOUT_MS = 15000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, status: 405, error: "Dozwolony tylko POST" });

  // Walidacja PRZED odczytem pól — puste lub niepoprawne zapytanie dostaje 400, a nie wyjątek serwera
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : null;
  if (!body) return res.status(400).json({ ok: false, status: 400, error: "Brak treści zapytania (JSON)" });
  const { webhookUrl, threadId, payload } = body;
  if (typeof webhookUrl !== "string" || !webhookUrl) return res.status(400).json({ ok: false, status: 400, error: "Brak webhookUrl" });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return res.status(400).json({ ok: false, status: 400, error: "Brak payload" });
  let payloadText;
  try { payloadText = JSON.stringify(payload); } catch { return res.status(400).json({ ok: false, status: 400, error: "Niepoprawny payload" }); }
  if (payloadText.length > MAX_PAYLOAD_CHARS) return res.status(413).json({ ok: false, status: 413, error: "Za duża wiadomość" });

  // Tylko webhooki Discorda — wcześniej proxy wysyłało dowolne dane pod DOWOLNY adres,
  // więc każdy, kto znał adres aplikacji, mógł go używać jako przekaźnika.
  let target;
  try { target = new URL(webhookUrl); } catch { return res.status(400).json({ ok: false, status: 400, error: "Niepoprawny webhookUrl" }); }
  const discordHost = ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"].includes(target.hostname);
  if (target.protocol !== "https:" || target.port || target.username || target.password
    || !discordHost || !/^\/api\/(v\d+\/)?webhooks\//.test(target.pathname)) {
    return res.status(400).json({ ok: false, status: 400, error: "Dozwolone są tylko webhooki Discorda" });
  }
  if (threadId != null && threadId !== "") {
    if (!/^\d{5,25}$/.test(String(threadId).trim())) return res.status(400).json({ ok: false, status: 400, error: "Niepoprawny Thread ID" });
    target.searchParams.set("thread_id", String(threadId).trim());
  }

  try {
    const resp = await fetch(target.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payloadText,
      redirect: "error", // webhook Discorda nie przekierowuje — przekierowanie oznacza coś podejrzanego
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
    if (resp.ok) return res.status(200).json({ ok: true, status: resp.status, retryAfter: null, error: null });
    // Odmowa Discorda: przekaż kod, komunikat i czas do ponowienia (retry_after w sekundach)
    const info = await resp.json().catch(() => null);
    const headerRetry = Number(resp.headers.get("retry-after"));
    const retryAfter = typeof info?.retry_after === "number" ? info.retry_after : (Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : null);
    return res.status(200).json({ ok: false, status: resp.status, retryAfter, error: info?.message || null });
  } catch (e) {
    return res.status(502).json({ ok: false, status: 502, retryAfter: null, error: e?.name === "TimeoutError" ? "Discord nie odpowiedział w czasie" : e.message });
  }
}
