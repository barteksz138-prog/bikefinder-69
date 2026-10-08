export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  let body;
  try { body = req.body; } catch { return res.status(400).json({ error: "Niepoprawny JSON" }); }

  const { provider, model, apiKey, messages, generationConfig, action, cachedContent, ttlSeconds, systemInstruction, cacheName } = body || {};
  if (!apiKey)   return res.status(400).json({ error: "Brak apiKey" });
  if (!model)    return res.status(400).json({ error: "Brak model" });

  // ── CACHE ACTIONS (Gemini explicit context caching) ────────────────────────────────────
  // Cel: duży, statyczny blok promptu (cennik/reguły osprzętu) potrafi urosnąć do kilku-kilkunastu
  // tysięcy tokenów. Zamiast wysyłać go w KAŻDYM wywołaniu (płacąc pełną stawkę input za każdym
  // razem), tworzymy go RAZ jako cachedContent po stronie Google, a potem tylko odwołujemy się do
  // niego po nazwie — odczyt z cache kosztuje ~10% ceny bazowej. Frontend (index.html) decyduje
  // KIEDY tworzyć/odświeżać cache (np. gdy zmieni się cennik) i trzyma nazwę cache po swojej stronie.
  //
  // UWAGA: Google w dokumentacji podaje NIESPÓJNE progi minimalnego rozmiaru dla cache jawnego
  // (explicit) — różne źródła mówią 2048 albo 32768 tokenów w zależności od modelu/wersji API.
  // Dlatego tworzenie cache może się nie udać dla mniejszych promptów — to NIE jest błąd aplikacji,
  // frontend musi to obsłużyć jako "brak cache" i po prostu wysłać pełny prompt jak dotychczas
  // (patrz fallback w index.html). Niezależnie od tego, "implicit caching" (automatyczne, 90%
  // zniżki przy trafieniu) działa OD RAZU na modelach 2.5+/3.x bez żadnego kodu — więc nawet gdy
  // jawny cache się nie uda, i tak część oszczędności przychodzi sama, o ile identyczny prefiks
  // promptu ląduje na początku kolejnych zapytań blisko siebie w czasie.
  if (action === "createCache") {
    if (!cacheName && !Array.isArray(messages) && !systemInstruction) {
      return res.status(400).json({ error: "Brak treści do zcache'owania (messages/systemInstruction)" });
    }
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`;
      const createBody = {
        model: `models/${model}`,
        ttl: `${ttlSeconds || 3300}s`, // domyślnie 55 min — trochę mniej niż typowe 1h wygaśnięcia, żeby zdążyć odświeżyć
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
        ...(Array.isArray(messages) ? { contents: messages } : {}),
      };
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createBody),
      });
      const data = await resp.json();
      return res.status(resp.status).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === "deleteCache") {
    try {
      if (!cacheName) return res.status(400).json({ error: "Brak cacheName" });
      const url = `https://generativelanguage.googleapis.com/v1beta/${cacheName}?key=${apiKey}`;
      const resp = await fetch(url, { method: "DELETE" });
      const data = resp.status === 204 ? {} : await resp.json().catch(() => ({}));
      return res.status(resp.status).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (!messages) return res.status(400).json({ error: "Brak messages" });

  // Gemini 2.5 i starsze używają thinkingBudget (liczba tokenów, 0 = wyłączone, -1 = dynamiczne/auto).
  // Gemini 3.x (w tym alias "gemini-flash-latest", który obecnie wskazuje na 3.5 Flash) używa
  // INNEGO parametru: thinkingLevel ("minimal"/"low"/"medium"/"high"). Wysłanie thinkingBudget
  // do modelu 3.x jest po cichu ignorowane (Google: "may result in unexpected performance") —
  // model wtedy myśli na domyślnym poziomie przy KAŻDYM zapytaniu, co dokłada drogie tokeny
  // "myślenia" (liczone jak output) i spowalnia odpowiedzi.
  //
  // cfg (opcjonalnie, z generationConfig frontendu) pozwala NADPISAĆ domyślne "brak myślenia" —
  // używane przy eskalacji Etapu 2 (Gemini) dla trudnych/niepewnych ogłoszeń: pierwsza próba leci
  // bez myślenia (tanio), a jeśli wynik to "niepewne", frontend ponawia z cfg.thinkingBudget = -1
  // (2.5 i starsze — dynamiczny budżet, model sam decyduje ile "pomyśleć") albo cfg.thinkingLevel
  // wyższym niż domyślny (3.x).
  const buildThinkingConfig = (m, cfg) => {
    const name = (m || "").toLowerCase();
    const isGen3 = /gemini-3|flash-latest|pro-latest/.test(name);
    if (isGen3) {
      if (cfg?.thinkingLevel) return { thinkingLevel: cfg.thinkingLevel };
      const isPro = /pro/.test(name);
      // Pro nie wspiera "minimal" (najniższy poziom to "low"); Flash/Flash-Lite wspierają "minimal".
      return { thinkingLevel: isPro ? "low" : "minimal" };
    }
    // Gemini 2.5 — dozwolone zakresy wg dokumentacji Google: Pro 128–32768 (myślenia NIE da się
    // wyłączyć — 0 kończy się błędem API, np. w czacie), Flash 0–24576, Flash-Lite 0 albo 512–24576
    // (np. 500 jest odrzucane). -1 = dynamiczny budżet we wszystkich trzech.
    const isPro25 = /2\.5-pro/.test(name);
    const isLite = /flash-lite/.test(name);
    let budget = cfg?.thinkingBudget != null ? cfg.thinkingBudget : (isPro25 ? -1 : 0);
    if (isPro25 && budget === 0) budget = 128;               // Pro: minimum zamiast wyłączenia
    if (isLite && budget > 0 && budget < 512) budget = 512;  // Flash-Lite: minimum 512
    return { thinkingBudget: budget };
  };

  try {
    if (provider === "groq") {
      // GPT-OSS to modele z rozumowaniem — tokeny "myślenia" liczą się do max_tokens.
      // reasoning_effort ("low"/"medium"/"high") wysyłamy TYLKO do GPT-OSS: inne modele Groqa
      // akceptują inne wartości tego parametru (albo wcale) i zwróciłyby błąd.
      const isGptOss = /^openai\/gpt-oss/i.test(model || "");
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
          ...(isGptOss && generationConfig?.reasoningEffort
            ? { reasoning_effort: generationConfig.reasoningEffort }
            : {}),
        }),
      });
      const data = await resp.json();
      return res.status(resp.status).json(data);

    } else {
      // Gemini
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const geminiBody = {
        contents: messages,
        // Gdy frontend ma aktywny explicit cache dla tego modelu/wariantu promptu — dołącz referencję.
        // Google wtedy TRAKTUJE cachedContent jako poprzedzający kontekst, a "contents" tutaj to
        // tylko nowa, dynamiczna część (samo ogłoszenie) — nie trzeba powtarzać statycznego cennika.
        ...(cachedContent ? { cachedContent } : {}),
        generationConfig: {
          temperature:       generationConfig?.temperature       ?? 0.7,
          maxOutputTokens:   generationConfig?.maxOutputTokens   ?? 2048,
          // Poprawny parametr thinking dobrany do generacji modelu (patrz buildThinkingConfig wyżej)
          thinkingConfig: buildThinkingConfig(model, generationConfig),
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
