export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  const { webhookUrl, threadId, payload } = req.body;
  if (!webhookUrl || !payload) return res.status(400).json({ error: "Brak webhookUrl lub payload" });
  try {
    const url = webhookUrl + (threadId ? `?thread_id=${threadId}` : "");
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    res.json({ ok: resp.ok, status: resp.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
