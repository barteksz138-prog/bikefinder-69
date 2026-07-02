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

  // Gemini 2.5 i starsze używają thinkingBudget (liczba tokenów, 0 = wyłączone).
  // Gemini 3.x (w tym alias "gemini-flash-latest", który obecnie wskazuje na 3.5 Flash) używa
  // INNEGO parametru: thinkingLevel ("minimal"/"low"/"medium"/"high"). Wysłanie thinkingBudget
  // do modelu 3.x jest po cichu ignorowane (Google: "may result in unexpected performance") —
  // model wtedy myśli na domyślnym poziomie przy KAŻDYM zapytaniu, co dokłada drogie tokeny
  // "myślenia" (liczone jak output) i spowalnia odpowiedzi.
  const buildThinkingConfig = (m) => {
    const name = (m || "").toLowerCase();
    const isGen3 = /gemini-3|flash-latest|pro-latest/.test(name);
    if (isGen3) {
      const isPro = /pro/.test(name);
      // Pro nie wspiera "minimal" (najniższy poziom to "low"); Flash/Flash-Lite wspierają "minimal".
      return { thinkingLevel: isPro ? "low" : "minimal" };
    }
    return { thinkingBudget: 0 };
  };

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
          // Poprawny parametr thinking dobrany do generacji modelu (patrz buildThinkingConfig wyżej)
          thinkingConfig: buildThinkingConfig(model),
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
