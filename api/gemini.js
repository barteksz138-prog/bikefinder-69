export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  let body;
  try { body = req.body; } catch { return res.status(400).json({ error: "Niepoprawny JSON" }); }

  const { provider, model, apiKey, messages, generationConfig } = body || {};
  if (!apiKey)   return res.status(400).json({ error: "Brak apiKey" });
  if (!model)    return res.status(400).json({ error: "Brak model" });
  if (!messages) return res.status(400).json({ error: "Brak messages" });

  try {
    if (provider === "groq") {
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: generationConfig?.temperature ?? 0.7,
          max_tokens:  generationConfig?.maxOutputTokens ?? 2048,
        }),
      });
      const data = await resp.json();
      return res.status(resp.status).json(data);

    } else {
      // Gemini
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const geminiBody = {
        contents: messages,
        generationConfig: {
          temperature:       generationConfig?.temperature       ?? 0.7,
          maxOutputTokens:   generationConfig?.maxOutputTokens   ?? 2048,
          // Wyłącz "thinking" żeby przyspieszyć odpowiedzi w czacie (Gemini 2.5/3.5 myśli domyślnie)
          thinkingConfig: { thinkingBudget: 0 },
          ...(generationConfig?.responseMimeType
            ? { responseMimeType: generationConfig.responseMimeType }
            : {}),
        },
      };
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
      });
      const data = await resp.json();
      return res.status(resp.status).json(data);
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
