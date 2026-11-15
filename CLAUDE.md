# DirtDealFinder (bikefinder-69) — instrukcje dla Claude

Skaner Kleinanzeigen.de szukający niedoszacowanych rowerów MTB (full, dirt, e-MTB) do odsprzedaży w Polsce. Od v6.16 także szosy i gravele — osobny tor włączany przełącznikiem (domyślnie wyłączony; docs/NOTATKI.md p. 1a).
Szczegółowa wiedza (HTML Kleinanzeigen, przebieg analizy, decyzje, historia wersji, pomysły): **docs/NOTATKI.md**.

## Zasady współpracy (ustalone z właścicielem — obowiązują zawsze)
- Rozmawiamy **po polsku**.
- **Najpierw ustalamy plan, zakres i rozwiązanie. Kod dopiero na wyraźne polecenie** („rób”, „koduj”, „wdrażaj”). Nie zaczynaj zmian z własnej inicjatywy.
- Zmiany zawsze na **osobnej gałęzi + pull request**. Nigdy nie wysyłaj prosto na `main` — właściciel sam klika „Merge”, a Vercel wdraża produkcję z `main`.
- Przed PR: podbij `APP_VERSION` w `public/index.html`, uruchom testy (`node tests/run-all.mjs`), dopisz testy na nowe zachowanie.
- Po scaleniu właściciel odświeża kartę skanera (autostart wznowi skanowanie, jeśli działał).
- Gdy coś jest niepewne (np. HTML Kleinanzeigen) — sprawdź na żywo (Chrome / proxy `/api/scrape`), nie zgaduj.

## Pliki
- `public/index.html` — cała aplikacja (React 18 + Babel w przeglądarce, ok. 4000 linii). Blok `// ==KB_START==` … `// ==KB_END==` to wbudowana baza cen. Blok `// ==ROAD_START==` … `// ==ROAD_END==` (v6.16) to cały tor szos i graveli: wyszukiwania, filtr słów, baza `KB_ROAD` (dane: `docs/ceny-szosy-olx-2026-11.md`), polecenia Groqa i analizy.
- `api/gemini.js` — pośrednik AI: Gemini, Groq, Anthropic (zamienia format Gemini ↔ Claude, pobiera zdjęcia z img.kleinanzeigen.de, cache 1 h).
- `api/discord.js` — wysyłka na webhooki Discorda (tylko discord.com, zwraca status/retryAfter).
- `api/scrape.js` — pobiera strony kleinanzeigen.de (tylko ta domena), zwraca prawdziwy status HTTP; strony wyników przycina do kart.
- `tests/` — testy (Playwright + atrapy Kleinanzeigen/AI/Discorda). `node tests/run-all.mjs` albo pojedynczy plik: `node tests/run-all.mjs tests512.mjs`. Na nowym komputerze: `cd tests && npm run setup` (esbuild + playwright + Chromium), potem `npm test`.

## Stan w przeglądarce (localStorage — osobny dla każdej przeglądarki i adresu!)
`ddf_cfg` (ustawienia, klucze API, webhooki; od v6.16 `roadEnabled`, `roadMaxBuyPrice`, `selectedRoad`, `roadFilterKeywords`, `roadWebhook`), `ddf_seen` (widziane ogłoszenia po numerze, z `lastSeenAt`; od v6.1 `watchSale`/`watchT` — wycena do obserwacji spadku ceny; od v6.4 `rej` — powód odrzucenia, `lastNightAt`; od v6.16 `pf: "r"` — wpis z toru szos / graveli), `ddf_pending` (kolejka analiz),
`ddf_outbox` (niewysłane powiadomienia), `ddf_scan_state` (stan wyszukiwań, `urlVersion`), `ddf_price_knowledge` (notatki cenowe z czatu),
`ddf_events` (dziennik zdarzeń), `ddf_autorun` (autostart po odświeżeniu), `ddf_ai_spend` (licznik kosztów, od v5.14 z `byStage`), `ddf_chat`,
`ddf_results` (ostatnie 200 wyników, v5.14), `ddf_dupes` (v6.1, zastąpił `ddf_alert_keys`; od v6.2 rekord roweru: tytuł+cena, sprzedawca, odciski opisu i zdjęć, powiązane numery, wycena do obserwacji, stan alertu pending/sent/lost).
`ddf_night` (v6.4: stan nocnego sprawdzania cen; od v6.15 także `discover` — nocne szukanie „za drogich”). Tylko jedna karta skanuje (v6.2, Web Locks `ddf-scanner`) — druga karta tego samego adresu jest podglądem; po przejęciu skanowania wczytuje stan od nowa (v6.4).
Wersja testowa (preview) Vercela ma inny adres → pustą pamięć i ustawienia; uruchomiona obok produkcji dublowałaby alerty.

## Dostęp i narzędzia
- GitHub: `barteksz138-prog/bikefinder-69` (publiczne — kluczy w kodzie NIE ma i nie może być; są tylko w localStorage).
- Vercel: projekt `bikefinder-69` (`prj_CM1XcEu7jPRVx9cNXFfGP6gQUnLw`, team `team_y4GQdmO9qWb1J0W9TswfmIV2`), produkcja https://bikefinder-69.vercel.app, plan Hobby: logi funkcji tylko 1 h, błędy (get_runtime_errors) 7 dni.
- Skaner działa w karcie **Chrome** właściciela, w grupie kart Claude (Claude in Chrome). Wolno czytać log/konsolę; niczego nie klikaj bez zgody. Uwaga: zamknięcie ostatniej karty w grupie usuwa grupę.
- Czytanie danych z karty skanera: `javascript_tool` + `console.log` w kawałkach po 3000 znaków + `read_console_messages` (duże wyniki są obcinane).

## Ustawienia właściciela (11.2026)
Analiza: Claude Haiku 5.5 · weryfikacja okazji: Claude Sonnet 5.5 · Groq gpt-oss-120b (12 kluczy) jako etap 1 · minimalny zysk po transporcie zależny od ceny zakupu — od v6 4 progi: 200–450 / 450–800 / 800–1100 / 1100–1400 € (`profitTiers` w `ddf_cfg`; start = dawne 35%) ·
cena zakupu 200–1400 € · transport 70 € · budżet AI 400 zł/mies. (realnie kilka zł) · e-MTB analizowane · rowery sprzed 2017 odrzucane (dirty tylko przy roczniku podanym w ogłoszeniu) ·
38 wyszukiwań modeli/marek + „Dirt” i „Dirtbike” ogólne · kanały Discord: okazje, niepewne, na granicy, problemy ·
„niepewne” tuż nad progiem → weryfikacja (v6.4) · nocne sprawdzanie cen od 2:00, „za drogie” do 2100 €, max 1500 stron/noc (v6.4) · katalog e-MTB w bazie (v6.4) · materiał ramy: tekst > napis > wygląd, karbon z wyglądu z ostrzeżeniem i zyskiem jako alu (v6.5). · Cube sprzed 2020 odrzucane, cena z opisu (np. weekendowa) liczona jako cena zakupu (v6.6). · Haiku: środkowy rocznik i środek pasma; Sonnet: ściąga generacji ram i dolna granica (v6.7). · Ściąga generacji: 30 modeli + kolory (v6.8). · Canyon Spectral sprzed 2018 (amortyzator pionowo) odrzucany; dirt nieznanej marki z nierozpoznanym widelcem i starym wyglądem odrzucany; „za mało opisu” z zyskiem ponad 10 pp pod progiem → „nie” (v6.9). · Zdjęcia do AI 1200×1600 ($_57); Cube z rocznikiem tylko oszacowanym < 2020 → „nie”, ale nie na stałe (v6.10). · Pola liczbowe ustawień zapisują się po wyjściu z pola / Enter; kolejka nie traci ofert po 48 h, gdy AI stoi (v6.11). · „Na granicy” ocenia tylko Haiku — bez weryfikacji Sonnetem; dirty z seryjnym Pike DJ / Bomber DJ (Bruce 2, Stitched 360 Pro / CLLCTV, Two6player Pro, Absolut RS / Pike) bez widelca w opisie i na zdjęciach liczone z widelcem seryjnym (v6.13). · Nocne szukanie „za drogich” (wyszukiwania powyżej limitu zakupu, tylko zapamiętanie); duplikat także przy poprawionym tytule; Cube Stereo ONE44 / ONE55 od 2023, ONE22 / ONE77 od 2022; środkowy rocznik liczy program (v6.15). · Szosy i gravele (v6.16): przełącznik domyślnie WYŁĄCZONY; 200–800 €, rocznik od 2014, hamulce szczękowe brane z niższą wyceną; baza cen z ofert OLX 11.2026 (dolna ćwiartka–mediana, 15 wpisów marek) — do skalibrowania na pierwszych sprzedażach, alerty traktować jako „do sprawdzenia”. · Szosy (v6.18, po teście na 780 ogłoszeniach — `docs/test-szosy-kleinanzeigen-2026-11.md`): „tak” bez ustalonego rocznika → „niepewne”; okazje w tym budżecie są rzadkie (ceny DE ≈ PL), główne ryzyko to stare karbony bez rocznika.
