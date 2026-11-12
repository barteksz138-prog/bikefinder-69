// ── ZDJĘCIA Z OGŁOSZENIA (analiza zdjęć) ─────────────────────────────────────────────────
// Frontend przysyła same adresy zdjęć (imageUrls) — serwer pobiera je z img.kleinanzeigen.de
// i dokleja do zapytania jako inlineData (base64). Dzięki temu przeglądarka nie przesyła zdjęć,
// a proxy nie da się użyć do pobierania czegokolwiek innego: tylko adresy zdjęć ogłoszeń Kleinanzeigen,
// najwyżej 6 zdjęć po maks. 5 MB, z limitem czasu. Zdjęcie, którego nie da się pobrać, jest pomijane.
const IMG_URL_RE = /^https:\/\/img\.kleinanzeigen\.de\/api\/v1\/prod-ads\/images\/[0-9a-f]{2}\/[0-9a-f-]{36}\?rule=\$_\d{1,3}\.(JPG|AUTO)$/i;
const MAX_IMAGES = 20;           // 4 przy zwykłej analizie; "niepewne" i weryfikacja okazji — wszystkie zdjęcia (do 20)
const IMAGE_CONCURRENCY = 4;     // pobieramy po 4 naraz, nie wszystkie jednocześnie — łagodniej dla serwera zdjęć Kleinanzeigen
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 8000;
const MAX_TOTAL_BASE64 = 16 * 1024 * 1024; // Google przyjmuje do ok. 20 MB w jednym zapytaniu
const ALLOWED_IMAGE_TYPES = { "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg", "image/png": "image/png", "image/webp": "image/webp" };

// v6.3: krótki cache pobranych zdjęć w pamięci instancji (np. pierwsza analiza z 4 zdjęciami, potem weryfikacja z 8 —
// te same 4 nie są pobierane drugi raz) + łączenie równoczesnych pobrań tego samego adresu. W serverless pamięć jednej
// instancji nie jest gwarantowana między wywołaniami — to tylko oszczędność pobrań, nie źródło danych. Rozdzielczość bez zmian.
const IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const IMAGE_CACHE_MAX_BYTES = 48 * 1024 * 1024; // base64
const imageCache = new Map();   // url → { part, at, size } (kolejność wstawienia = od najstarszego)
const imageInflight = new Map(); // url → Promise<part|null>
export const __imageCacheStats = { fetches: 0, hits: 0 };
export const __clearImageCache = () => { imageCache.clear(); imageInflight.clear(); __imageCacheStats.fetches = 0; __imageCacheStats.hits = 0; };
const cacheImage = (url, part) => {
  const size = part.inlineData.data.length;
  if (size > IMAGE_CACHE_MAX_BYTES / 4) return;
  imageCache.delete(url);
  imageCache.set(url, { part, at: Date.now(), size });
  let total = 0;
  for (const e of imageCache.values()) total += e.size;
  for (const [k, e] of imageCache) { if (total <= IMAGE_CACHE_MAX_BYTES) break; imageCache.delete(k); total -= e.size; }
};
const fetchImagePart = async (url) => {
  if (typeof url !== "string" || !IMG_URL_RE.test(url)) return null;
  const hit = imageCache.get(url);
  if (hit && Date.now() - hit.at < IMAGE_CACHE_TTL_MS) { __imageCacheStats.hits++; return hit.part; }
  if (hit) imageCache.delete(url);
  if (imageInflight.has(url)) { __imageCacheStats.hits++; return imageInflight.get(url); }
  const p = fetchImagePartNow(url).then(part => { if (part) cacheImage(url, part); return part; }).finally(() => imageInflight.delete(url));
  imageInflight.set(url, p);
  return p;
};
const fetchImagePartNow = async (url) => {
  __imageCacheStats.fetches++;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/jpeg,image/png,image/webp;q=0.9",
      },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const mimeType = ALLOWED_IMAGE_TYPES[(resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()];
    if (!mimeType) return null;
    const declared = Number(resp.headers.get("content-length") || 0);
    if (declared > MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    return { inlineData: { mimeType, data: buf.toString("base64") } };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// Zdjęcia idą PRZED tekstem w ostatniej wiadomości (zalecenie Google dla zapytań z obrazami).
// maxPerImage — limit pojedynczego zdjęcia u danego dostawcy (Claude: 5 MB po zakodowaniu)
const attachImages = async (messages, imageUrls, maxPerImage = Infinity) => {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0 || !Array.isArray(messages) || messages.length === 0) {
    return { contents: messages, attached: 0 };
  }
  const urls = [...new Set(imageUrls)].filter(u => typeof u === "string" && IMG_URL_RE.test(u)).slice(0, MAX_IMAGES);
  // Google przyjmuje do ok. 20 MB danych w jednym zapytaniu — trzymamy zdjęcia łącznie poniżej 16 MB (base64)
  let total = 0;
  const fetched = [];
  for (let i = 0; i < urls.length; i += IMAGE_CONCURRENCY) {
    fetched.push(...await Promise.all(urls.slice(i, i + IMAGE_CONCURRENCY).map(fetchImagePart)));
  }
  // Najpierw limit pojedynczego zdjęcia, potem łączny — licznik rośnie TYLKO o zdjęcia faktycznie dołączone,
  // więc pominięte duże zdjęcie nie blokuje późniejszych małych.
  const parts = [];
  for (const p of fetched) {
    if (!p) continue;
    const len = p.inlineData.data.length;
    if (len > maxPerImage || total + len > MAX_TOTAL_BASE64) continue;
    total += len;
    parts.push(p);
  }
  if (parts.length === 0) return { contents: messages, attached: 0 };
  // Zdjęcia wstawiamy ZA stałą częścią promptu (baza cen + reguły, oznaczona cacheControl), a PRZED danymi
  // ogłoszenia. Inaczej różne zdjęcia na początku zapytania psułyby wspólny początek promptu i cache
  // (Claude dopasowuje cały prefiks razem ze zdjęciami; automatyczny cache Gemini działa tak samo).
  const last = messages[messages.length - 1] || {};
  const lastParts = Array.isArray(last.parts) ? last.parts : [];
  let at = -1;
  lastParts.forEach((p, i) => { if (p?.cacheControl) at = i; });
  const merged = [...lastParts.slice(0, at + 1), ...parts, ...lastParts.slice(at + 1)];
  return {
    contents: [...messages.slice(0, -1), { ...last, parts: merged }],
    attached: parts.length,
  };
};

// ── CLAUDE (Anthropic) ───────────────────────────────────────────────────────────────────
// Frontend wysyła zapytania w formacie Gemini (contents/parts, generationConfig), a proxy
// tłumaczy je na Messages API Anthropic i odpowiedź z powrotem na format Gemini (candidates,
// finishReason, usageMetadata). Dzięki temu reszta aplikacji (parsowanie JSON, ponawianie,
// licznik kosztów) działa bez zmian dla obu dostawców.
// Haiku 5.5: myślenie sterowane przez output_config.effort ("low"/"medium"/"high"); budget_tokens
// i temperature są odrzucane przez API, więc ich nie wysyłamy.
const CLAUDE_MAX_IMAGE_BASE64 = 5 * 1024 * 1024; // limit Anthropic: 5 MB na zdjęcie (po zakodowaniu)
const CLAUDE_EFFORTS = ["low", "medium", "high"];

// Poziom myślenia: jawny claudeEffort z frontendu albo przybliżenie z "gałek" Gemini.
const claudeEffortFrom = (cfg) => {
  if (CLAUDE_EFFORTS.includes(cfg?.claudeEffort)) return cfg.claudeEffort;
  if (["minimal", "low"].includes(cfg?.thinkingLevel)) return "low";
  if (cfg?.thinkingLevel === "high") return "high";
  if (cfg?.thinkingLevel === "medium") return "medium";
  const b = cfg?.thinkingBudget;
  if (b === -1) return "medium";
  if (typeof b === "number") return b >= 8192 ? "high" : b >= 2048 ? "medium" : "low";
  return "medium"; // domyślny poziom Haiku 5.5 (np. czat)
};

// Części w formacie Gemini → bloki treści Anthropic. Część z cacheControl (statyczna baza cen +
// reguły) dostaje znacznik cache na 1 h — zapis kosztuje 2× stawkę wejścia, ale każdy odczyt tylko
// 10% stawki, a przy analizach rozłożonych w ciągu dnia 5-minutowy cache ciągle by wygasał.
const toClaudeContent = (parts) => (Array.isArray(parts) ? parts : []).map(p => {
  if (p?.inlineData?.data) {
    return { type: "image", source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data } };
  }
  const block = { type: "text", text: String(p?.text ?? "") };
  if (p?.cacheControl) block.cache_control = { type: "ephemeral", ttl: "1h" };
  return block;
}).filter(b => b.type !== "text" || b.text.length > 0);

const callClaude = async ({ model, apiKey, contents, generationConfig }) => {
  const messages = contents.map(m => ({
    role: m.role === "model" || m.role === "assistant" ? "assistant" : "user",
    content: toClaudeContent(m.parts),
  })).filter(m => m.content.length > 0);
  const effort = claudeEffortFrom(generationConfig);
  const minTokens = effort === "high" ? 32000 : effort === "medium" ? 16000 : 8000; // myślenie liczy się do max_tokens
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(64000, Math.max(minTokens, Number(generationConfig?.maxOutputTokens) || 0)),
      thinking: { type: "adaptive" },
      output_config: { effort },
      messages,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data?.type === "error") {
    // Komunikat z kodem HTTP — frontend rozpoznaje po nim limity (429) i przeciążenie (529)
    const retryAfter = resp.headers.get("retry-after");
    const msg = `Claude HTTP ${resp.status} ${data?.error?.type || ""}: ${data?.error?.message || "nieznany błąd"}`
      + (retryAfter ? ` (retry in ${retryAfter}s)` : "");
    return { status: resp.ok ? 500 : resp.status, body: { error: { message: msg, code: resp.status } } };
  }
  const text = (data.content || []).filter(b => b?.type === "text").map(b => b.text).join("");
  const finishReason = data.stop_reason === "max_tokens" ? "MAX_TOKENS"
    : data.stop_reason === "refusal" ? "SAFETY" : "STOP";
  const u = data.usage || {};
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheWrite = u.cache_creation_input_tokens || 0;
  return {
    status: 200,
    body: {
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }],
      // Ten sam kształt co usageMetadata Gemini (promptTokenCount obejmuje tokeny z cache),
      // plus cacheWriteTokenCount — zapis do cache Claude jest płatny osobno.
      usageMetadata: {
        promptTokenCount: (u.input_tokens || 0) + cacheRead + cacheWrite,
        cachedContentTokenCount: cacheRead,
        cacheWriteTokenCount: cacheWrite,
        candidatesTokenCount: u.output_tokens || 0, // u Claude obejmuje też tokeny myślenia
        thoughtsTokenCount: 0,
      },
      modelVersion: data.model || model,
    },
  };
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  let body;
  try { body = req.body; } catch { return res.status(400).json({ error: "Niepoprawny JSON" }); }

  const { provider, model, apiKey, messages, generationConfig, action, cachedContent, ttlSeconds, systemInstruction, cacheName, imageUrls } = body || {};
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

    } else if (provider === "anthropic") {
      if (!/^claude-[a-z0-9.\-]+$/i.test(model)) return res.status(400).json({ error: { message: "Niepoprawny model Claude" } });
      const wantsImages = Array.isArray(imageUrls) && imageUrls.length > 0;
      // Anthropic odrzuca zdjęcia powyżej 5 MB (base64) — takie pomijamy od razu, zamiast tracić całe zapytanie
      const { contents, attached } = wantsImages ? await attachImages(messages, imageUrls, CLAUDE_MAX_IMAGE_BASE64) : { contents: messages, attached: 0 };
      const { status, body: out } = await callClaude({ model, apiKey, contents, generationConfig });
      if (wantsImages && out && !out.error) out.imagesAttached = attached;
      return res.status(status).json(out);

    } else {
      // Gemini
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      // Analiza zdjęć: pobierz zdjęcia ogłoszenia i dołącz je do ostatniej wiadomości (patrz attachImages)
      const wantsImages = Array.isArray(imageUrls) && imageUrls.length > 0;
      const { contents, attached } = wantsImages ? await attachImages(messages, imageUrls) : { contents: messages, attached: 0 };
      const geminiBody = {
        // cacheControl to znacznik tylko dla Claude — Google odrzuciłby nieznane pole
        contents: Array.isArray(contents)
          ? contents.map(m => Array.isArray(m?.parts) ? { ...m, parts: m.parts.map(({ cacheControl, ...p }) => p) } : m)
          : contents,
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
      // Ile zdjęć faktycznie dołączono — frontend loguje to i liczy tylko udane zdjęcia
      if (wantsImages && data && typeof data === "object" && !Array.isArray(data)) data.imagesAttached = attached;
      return res.status(resp.status).json(data);
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
