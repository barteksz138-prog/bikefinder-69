export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  const { webhookUrl, threadId, payload } = req.body;
  if (!webhookUrl || !payload) return res.status(400).json({ error: "Brak webhookUrl lub payload" });

  // Tylko webhooki Discorda — wcześniej proxy wysyłało dowolne dane pod DOWOLNY adres,
  // więc każdy, kto znał adres aplikacji, mógł go używać jako przekaźnika.
  let target;
  try { target = new URL(webhookUrl); } catch { return res.status(400).json({ error: "Niepoprawny webhookUrl" }); }
  const discordHost = ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"].includes(target.hostname);
  if (target.protocol !== "https:" || !discordHost || !/^\/api\/(v\d+\/)?webhooks\//.test(target.pathname)) {
    return res.status(400).json({ error: "Dozwolone są tylko webhooki Discorda" });
  }
  if (threadId) target.searchParams.set("thread_id", String(threadId));

  try {
    const resp = await fetch(target.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    res.json({ ok: resp.ok, status: resp.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
