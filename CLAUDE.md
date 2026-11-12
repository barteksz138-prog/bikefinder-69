# DirtDealFinder (bikefinder-69) — instrukcje dla Claude

Skaner Kleinanzeigen.de szukający niedoszacowanych rowerów MTB (full, dirt, e-MTB) do odsprzedaży w Polsce.
Szczegółowa wiedza (HTML Kleinanzeigen, przebieg analizy, decyzje, historia wersji, pomysły): **docs/NOTATKI.md**.

## Zasady współpracy (ustalone z właścicielem — obowiązują zawsze)
- Rozmawiamy **po polsku**.
- **Najpierw ustalamy plan, zakres i rozwiązanie. Kod dopiero na wyraźne polecenie** („rób”, „koduj”, „wdrażaj”). Nie zaczynaj zmian z własnej inicjatywy.
- Zmiany zawsze na **osobnej gałęzi + pull request**. Nigdy nie wysyłaj prosto na `main` — właściciel sam klika „Merge”, a Vercel wdraża produkcję z `main`.
- Przed PR: podbij `APP_VERSION` w `public/index.html`, uruchom testy (`node tests/run-all.mjs`), dopisz testy na nowe zachowanie.
- Po scaleniu właściciel odświeża kartę skanera (autostart wznowi skanowanie, jeśli działał).
- Gdy coś jest niepewne (np. HTML Kleinanzeigen) — sprawdź na żywo (Chrome / proxy `/api/scrape`), nie zgaduj.

## Pliki
- `public/index.html` — cała aplikacja (React 18 + Babel w przeglądarce, ok. 4000 linii). Blok `// ==KB_START==` … `// ==KB_END==` to wbudowana baza cen.
- `api/gemini.js` — pośrednik AI: Gemini, Groq, Anthropic (zamienia format Gemini ↔ Claude, pobiera zdjęcia z img.kleinanzeigen.de, cache 1 h).
- `api/discord.js` — wysyłka na webhooki Discorda (tylko discord.com, zwraca status/retryAfter).
- `api/scrape.js` — pobiera strony kleinanzeigen.de (tylko ta domena), zwraca prawdziwy status HTTP; strony wyników przycina do kart.
- `tests/` — testy (Playwright + atrapy Kleinanzeigen/AI/Discorda). `node tests/run-all.mjs` albo pojedynczy plik: `node tests/run-all.mjs tests512.mjs`.

## Stan w przeglądarce (localStorage — osobny dla każdej przeglądarki i adresu!)
`ddf_cfg` (ustawienia, klucze API, webhooki), `ddf_seen` (widziane ogłoszenia po numerze, z `lastSeenAt`), `ddf_pending` (kolejka analiz),
`ddf_outbox` (niewysłane powiadomienia), `ddf_scan_state` (stan wyszukiwań, `urlVersion`), `ddf_price_knowledge` (notatki cenowe z czatu),
`ddf_events` (dziennik zdarzeń), `ddf_autorun` (autostart po odświeżeniu), `ddf_ai_spend` (licznik kosztów, od v5.14 z `byStage`), `ddf_chat`,
`ddf_results` (ostatnie 200 wyników, v5.14), `ddf_alert_keys` (tytuł+cena wysłanych alertów z 24 h — duplikaty, v5.14).
Wersja testowa (preview) Vercela ma inny adres → pustą pamięć i ustawienia; uruchomiona obok produkcji dublowałaby alerty.

## Dostęp i narzędzia
- GitHub: `barteksz138-prog/bikefinder-69` (publiczne — kluczy w kodzie NIE ma i nie może być; są tylko w localStorage).
- Vercel: projekt `bikefinder-69` (`prj_CM1XcEu7jPRVx9cNXFfGP6gQUnLw`, team `team_y4GQdmO9qWb1J0W9TswfmIV2`), produkcja https://bikefinder-69.vercel.app, plan Hobby: logi funkcji tylko 1 h, błędy (get_runtime_errors) 7 dni.
- Skaner działa w karcie **Chrome** właściciela, w grupie kart Claude (Claude in Chrome). Wolno czytać log/konsolę; niczego nie klikaj bez zgody. Uwaga: zamknięcie ostatniej karty w grupie usuwa grupę.
- Czytanie danych z karty skanera: `javascript_tool` + `console.log` w kawałkach po 3000 znaków + `read_console_messages` (duże wyniki są obcinane).

## Ustawienia właściciela (11.2026)
Analiza: Claude Haiku 5.5 · weryfikacja okazji: Claude Sonnet 5.5 · Groq gpt-oss-120b (12 kluczy) jako etap 1 · minimalny zysk 35% (po transporcie) ·
cena zakupu 200–1400 € · transport 70 € · budżet AI 400 zł/mies. (realnie kilka zł) · e-MTB analizowane · rowery sprzed 2017 odrzucane (dirty tylko przy roczniku podanym w ogłoszeniu) ·
38 wyszukiwań modeli/marek + „Dirt” i „Dirtbike” ogólne · kanały Discord: okazje, niepewne, na granicy, problemy.
