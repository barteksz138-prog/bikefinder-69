# DirtDealFinder — notatki projektu

Wiedza zebrana podczas budowy (stan: 11.11.2026, v5.12). Instrukcje pracy: `CLAUDE.md`.

## 1. Jak działa jeden cykl
1. Wyczyszczenie kolejek, wysłanie zaległych powiadomień (outbox), dokończenie zaległych ofert z etapu 1.
2. Dla każdego wybranego wyszukiwania (odstęp 6–7,5 s, przerwa 60 s po pełnym obiegu):
   - pobranie strony wyników przez `/api/scrape`, parsowanie kart;
   - captcha / HTTP 403/429 dwa razy pod rząd → 20 min przerwy we wszystkich zapytaniach + komunikat na Discord;
   - ≥50% kart bez ceny → wyszukiwanie pominięte (zmiana HTML), nic nie oznaczane jako widziane;
   - nowe ogłoszenia (nieznany numer) → kolejka; pierwsze skanowanie wyszukiwania = tylko zapamiętanie (bez analizy);
   - po przerwie > 24 h, po „pustym starcie” albo po zmianie linków (`SEARCH_URL_VERSION`) → analiza tylko ofert z ostatnich 24 h (+ do 5 bez daty);
   - spadek ceny ≥ 20% albo spadek poniżej limitu zakupu → ponowna analiza; w ogłoszeniu bez ceny pojawiła się cena → analiza;
   - wyszukiwania bez nowych ofert od 3 dni sprawdzane co ok. 10 min;
   - etap 1 i etap 2 od razu po każdym wyszukiwaniu (alert szybciej).
3. **Etap 1 (za darmo / Groq):** filtr słów w tytule (całe słowa), filtr rocznika w tytule (pomija „2000 km”, „NP 2000 €”, „180er”), brak ceny → odrzucone, cena < 200 € albo > 1400 € → odrzucone, Groq: full / dirt / elektryk_gorski / inny / niepewne / stary.
   Znany model w tytule (lista dirtów `DIRT_MODEL_RE` albo wszystkie słowa wyszukiwania modelu) bez słów o części → „inny/stary” Groqa nie odrzuca, decyduje AI.
4. **Etap 2 (AI):** pełny opis ze strony ogłoszenia (max 15 stron na cykl, 4 s odstępu), pierwsza analiza z 4 zdjęciami.
   - „niepewne” → druga analiza ze wszystkimi zdjęciami; „nie” blisko progu (±8%) → druga analiza z 4 zdjęciami;
   - „tak” → weryfikacja „adwokat diabła” na modelu weryfikacji ze wszystkimi zdjęciami (do 20);
   - twarde reguły w kodzie: rocznik < 2017, e-bike (jeśli wykluczone), sklep + nowy, sama część, limit ceny względem „ceny nowego” zależny od wieku, zysk = sprzedaż − zakup − transport, próg zysku;
   - „nie” mimo zysku ≥ progu → „tak” (sprawdzi weryfikacja); u weryfikatora → do niepewnych;
   - „niepewne” z kompletnymi liczbami i zyskiem < progu → „nie” (trafia do „na granicy”);
   - sprzeczny typ (Groq vs AI) → wygrywa AI, adnotacja w alercie.
5. **Wysyłka:** okazja (zaległa > 30 min → najpierw sprawdzenie strony ogłoszenia: usunięte / zmiana ceny), „na granicy” (cena musi spaść ≤ 20%, propozycja ≈ 88% kwoty „opłaca się do”, wiadomość po niemiecku z powodami od AI), lista niepewnych na koniec cyklu, komunikaty o problemach (ten sam rodzaj najwyżej co 6 h).
6. Krytyczny błąd AI (brak środków, zły klucz) → analizy wstrzymane, oferty czekają w kolejce, komunikat na Discord.

## 2. HTML Kleinanzeigen (sprawdzone na żywo 11.11.2026)
**Lista wyników** (nowy układ Astro/Tailwind od ~09.2026):
- karta `article[data-adid]` z `data-href="/s-anzeige/<tytuł>/<numer>-217-<miejsce>"`; numer ogłoszenia = najpewniejszy identyfikator (tytuł w linku zmienia się przy edycji);
- tytuł `h3 > a`; opis `h3 + p` (ok. 100 znaków, „…”); w karcie JSON-LD `ImageObject` z `title`, `description` (ok. 300 znaków), `contentUrl` (zdjęcie `?rule=$_59.AUTO`);
- cena `p.text-title3` (np. „1.100 € VB”, samo „VB”, „Zu verschenken”); stara cena po obniżce: drugi `p.text-title3` z klasą `line-through`;
- `span`: „51570 Windeck” (kod + miasto), data „Heute, HH:MM” / „Gestern, HH:MM” / „dd.mm.rrrr”, „Versand möglich”, „Direkt kaufen”;
- liczba zdjęć w `[data-image-container] div`.

**Strona ogłoszenia:**
- `#viewad-main`, `#viewad-title`, `#viewad-price`, `#viewad-locality`, `#viewad-extra-info` (data), `#viewad-description-text`;
- `meta[itemprop=price]` (np. „1100.00”), `og:image`;
- galeria: `.galleryimage-element img#viewad-image` (pełne zdjęcia `$_59`), miniatury `imagebox-thumbnail` (`$_1`) — nie dublować;
- `.addetailslist--detail`: „Art Herren”, „Typ Mountainbikes”, „Zustand Sehr Gut”; „Nur Abholung” / wysyłka;
- `#viewad-contact` / `#viewad-profile-box`: „Privater Nutzer”, „Aktiv seit dd.mm.rrrr”, „N Anzeigen online”, „TOP Zufriedenheit”.

**Usunięte ogłoszenie:** HTTP 200 + strona kategorii z INNYMI ofertami (ich opisy w JSON-LD), `link[rel=canonical]` → `/s-fahrraeder/<miasto>/c217l…`, brak `#viewad-main`.

**Filtry w linkach (działają):** `/s-fahrraeder/anzeige:angebote/preis:200:1400/<fraza>/k0c217+fahrraeder.type_s:(ebike%2Cmountainbike)`.
Sam `type_s:mountainbike` gubi e-MTB (Torque:ON, Heckler, Vala) i rowery z innym typem; dirty często mają inny typ — łapią je ogólne wyszukiwania „dirt”/„dirtbike” (bez filtra typu).
Całe Fahrräder z typem MTB w zakresie 200–1400 €: wieczorem ok. 1 ogłoszenie/min, w nocy kilka/h.

## 3. Koszty i modele (11.2026, USD za 1 mln tokenów: wejście / wyjście)
Claude Haiku 5.5: 0,10 / 0,50 (zapis cache 0,20) · Claude Sonnet 5.5: 2 / 10 (zapis cache 4) · Gemini 2.5 Flash: 0,30 / 2,50 · Gemini 2.5 Pro: 1,25 / 10.
Kurs w aplikacji: 1 USD = 3,80 zł, 1 € = 4,35 zł. Weryfikacja na Sonnecie ze wszystkimi zdjęciami ≈ 35–60 gr; zwykła analiza na Haiku ≈ 0,3–1 gr.
Realnie: ok. 0,7 zł/dobę przy 38 wyszukiwaniach. Groq na darmowym planie: ok. 200 tys. tokenów/dzień na KONTO (kilka kluczy z jednego konta dzieli limit).

## 4. Decyzje właściciela (nie zmieniać bez pytania)
- AI ma wysyłać okazje; „podejrzanie niska cena / możliwe oszustwo / ukryte wady” to NIE powód do „niepewne” ani „nie” — trafia do pola „Do sprawdzenia”, właściciel weryfikuje sam.
- Ogłoszenie bez ceny → odrzucone od razu, bez AI (wraca, gdy cena się pojawi). Minimalna cena ogłoszenia 200 €.
- Weryfikacja okazji i dokładna analiza niepewnych — wszystkie zdjęcia z ogłoszenia; okazja zweryfikowana tylko z opisu też jest wysyłana (z adnotacją).
- Limit rocznika 2017 dotyczy też dirtów.
- Jeden ogólny link zamiast wyszukiwań modeli — testowany wcześniej, za dużo śmieci → zostają wyszukiwania modeli.
- Dodatkowe dane sprzedawcy/wysyłki/stanu w alertach — na razie nie.
- Stare notatki cenowe z lipca 2026 (sprzeczne z bazą) — usunięte przez właściciela 11.11.2026.

## 5. Pomysły na później (nie zaczynać bez zgody)
- Wersja serwerowa (bez komputera właściciela): Vercel Hobby pozwala na cron tylko raz dziennie → zewnętrzny zegar (np. cron-job.org) wołający funkcję co minutę albo Vercel Pro; stan zamiast localStorage w bazie (np. Upstash Redis); praca dzielona na krótkie kawałki (limit czasu funkcji); klucze w zmiennych środowiskowych Vercela; strona = tylko panel.
- Dane w alertach: lokalizacja, sprzedawca (prywatny/firma, konto od kiedy, liczba ogłoszeń), wysyłka/odbiór, stan (selektory w p. 2).
- Przypominanie „prawie okazji”, gdy cena spadnie do kwoty „opłaca się do”; historia kupionych/sprzedanych rowerów → notatki cenowe.
- Raport z ChatGPT „Analiza błędów kodu” — nieprzeczytany (karta była niedostępna).
- Repo prywatne; ostrzeżenie Node `DEP0169 url.parse()` w `/api/scrape` jest niegroźne (pochodzi ze środowiska Vercela).

## 6. Ryzyka i ograniczenia
- Regulamin Kleinanzeigen (§ 5 pkt 1) zakazuje automatycznego pobierania treści bez zgody — dotyczy całego skanera. Nie przyspieszać odpytywania; blokady mają bezpiecznik.
- Zapytania idą z serwerów Vercela (`/api/scrape`), nie z komputera właściciela.
- Chrome usypia karty w tle (Ustawienia → Wydajność → dodać adres skanera do „zawsze aktywne”); Opera GX ma limity GX Control.
- Log w aplikacji trzyma ok. 500 linii (kilka cykli) — do historii służy „Dziennik zdarzeń” w Statusie.

## 7. Historia wersji (skrót)
- v5.4–5.5: Claude Haiku jako dostawca analizy.
- v5.6: kolejka analiz i outbox (nic nie ginie przy błędzie/STOP), reguła 24 h, „Zacznij od zera”, transport 70 € liczony w kodzie, poprawki filtrów.
- v5.7: zdjęcia przy każdej analizie, Sonnet 5.5 do weryfikacji, eskalacje.
- v5.8: wszystkie zdjęcia przy weryfikacji/niepewnych; v5.9: poprawki z audytu (captcha, STOP, zaległe okazje).
- v5.10: brak ceny → odrzucone; podejrzenia → pole „ostrzeżenia” zamiast „niepewne”.
- v5.11: numer ogłoszenia jako ID (+migracja), pamięć 15 000 ogłoszeń wg ostatniego widzenia, min. cena 200 €, bezpiecznik blokad, krytyczne błędy AI, analiza zaraz po wyszukiwaniu, rzadkie wyszukiwania, zdjęcie/rozmiar/„dodano”/obniżka w alercie, komunikaty o problemach, kanał „na granicy”, autozapis ustawień.
- v5.12: odstęp 6 s, typ Mountainbike + E-Bike, usunięte ogłoszenia, poprawki Groqa (dirty, dłuższy opis, ostrożniej ze „stary”), nowe progi „na granicy”, alerty bez powtórzeń i po polsku, rocznik jako zakres, dziennik zdarzeń, autostart.
