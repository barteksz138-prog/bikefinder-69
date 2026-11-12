# DirtDealFinder — notatki projektu

Wiedza zebrana podczas budowy (stan: 12.11.2026, v6.0). Instrukcje pracy: `CLAUDE.md`.

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
   v5.14: „inny”, bo Groq uznał ogłoszenie za ramę/część (`GROQ_PART_REASON_RE` w uzasadnieniu), przy tytule bez słowa o części i cenie ≥ progu niepewnych (500 €) → decyduje AI. „Rahmen L” w opisie = rozmiar ramy (w prompcie Groqa).
4. **Etap 2 (AI):** pełny opis ze strony ogłoszenia (max 15 stron na cykl, 4 s odstępu), pierwsza analiza z 4 zdjęciami.
   - dirt (z Etapu 1 albo znany model dirtowy w tytule) → od razu wszystkie zdjęcia + ściąga widelców (`DIRT_FORK_GUIDE`); v5.14: gdy AI dopiero rozpozna dirta — pierwsza analiza jeszcze raz, z wpisem bazy o dirtach, ściągą i wszystkimi zdjęciami;
   - pole `widelec` {model, zrodlo: napis/opis/wyglad/nieznany, sztywny, bezModelu}; w dircie widelec z wyglądu, nierozpoznany albo sama marka bez modelu (RockShox/Fox/Manitou/Marzocchi; X-Fusion/Suntour/RST nie — to zawsze słabsze pasmo) → wpis w „Do sprawdzenia”; sztywny widelec w dircie → odrzucone;
   - wynik graniczny dirta, który widział już wszystkie zdjęcia → bez drugiej analizy (v5.14);
   - „niepewne” → druga analiza ze wszystkimi zdjęciami; „nie” blisko progu (±8%) → druga analiza z 4 zdjęciami;
   - „tak” → weryfikacja „adwokat diabła” na modelu weryfikacji ze wszystkimi zdjęciami (do 20);
   - twarde reguły w kodzie: rocznik < 2017 (w dircie tylko rocznik PODANY w ogłoszeniu — v5.14), e-bike (jeśli wykluczone), sklep + nowy, sama część, limit ceny względem „ceny nowego” zależny od wieku, zysk = sprzedaż − zakup − transport, próg zysku;
   - „nie” mimo zysku ≥ progu → „tak” (sprawdzi weryfikacja); u weryfikatora → do niepewnych;
   - „niepewne” z kompletnymi liczbami i zyskiem < progu → „nie” (trafia do „na granicy”);
   - sprzeczny typ (Groq vs AI) → wygrywa AI, adnotacja w alercie.
5. **Wysyłka:** okazja (zaległa > 30 min → najpierw sprawdzenie strony ogłoszenia: usunięte / zmiana ceny), „na granicy” (cena musi spaść ≤ 20%, propozycja ≈ 88% kwoty „opłaca się do”, wiadomość po niemiecku z powodami od AI), lista niepewnych na koniec cyklu, komunikaty o problemach (ten sam rodzaj najwyżej co 6 h).
6. Krytyczny błąd AI (brak środków, zły klucz) → analizy wstrzymane, oferty czekają w kolejce, komunikat na Discord. v5.14: gdy przerwał weryfikację (albo STOP) — wynik pierwszej analizy zapisany w kolejce (`firstResult` + odcisk opisu/zdjęć/ceny), następne podejście zaczyna od weryfikacji.
7. Ponawianie (v5.14): jedna próba na ofertę na cykl (także pobranie strony), po nieudanej analizie następna za 10 min, potem za 30 min (3. nieudana → niepewne); 2 nieudane analizy pod rząd → 10 min przerwy w analizach AI + komunikat.
8. Aktualność (v5.14): zaległa okazja (> 30 min) — gdy opis lub zdjęcia zmieniły się od analizy, nie jest wysyłana, wraca do analizy. Strona ogłoszenia bez ceny → za 1. razem czekamy do następnego cyklu, za 2. analiza, ale okazja idzie do niepewnych.
9. „Opłaca się do” (v5.14): po „nie” z kompletnymi liczbami kwota zapisywana w `ddf_seen` (`nearMax`); spadek ceny do niej → ponowna analiza (nawet przy spadku < 20%). Ten sam tytuł + cena pod innym numerem w ciągu 24 h → drugi alert pomijany (`ddf_alert_keys`).

## 2. HTML Kleinanzeigen (sprawdzone na żywo 11.11.2026)
**Lista wyników** (nowy układ Astro/Tailwind od ~09.2026):
- karta `article[data-adid]` z `data-href="/s-anzeige/<tytuł>/<numer>-217-<miejsce>"`; numer ogłoszenia = najpewniejszy identyfikator (tytuł w linku zmienia się przy edycji);
- tytuł `h3 > a`; opis `h3 + p` (ok. 100 znaków, „…”); w karcie JSON-LD `ImageObject` z `title`, `description` (ok. 300 znaków), `contentUrl` (zdjęcie `?rule=$_59.AUTO`);
- cena `p.text-title3` (np. „1.100 € VB”, samo „VB”, „Zu verschenken”); stara cena po obniżce: drugi `p.text-title3` z klasą `line-through`;
- `span`: „51570 Windeck” (kod + miasto — od v5.14 stąd lokalizacja, sprawdzone 12.11.2026: 27/27 kart), data „Heute, HH:MM” / „Gestern, HH:MM” / „dd.mm.rrrr”, „Versand möglich”, „Direkt kaufen”;
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
Realnie: ok. 0,7 zł/dobę przy 38 wyszukiwaniach. Groq na darmowym planie: ok. 200 tys. tokenów/dzień na KONTO (kilka kluczy z jednego konta dzieli limit) — właściciel ma 12 kluczy z 12 różnych kont (sprawdzone 12.11.2026).
Pomiar 12.11.2026 (Haiku, prawdziwe dirty, ciepły cache): pierwsza analiza dirta ze wszystkimi zdjęciami (4–17) 0,9–1,4 gr, z zimnym cache 2,3 gr; cache 14 355 tokenów stałej części działa; zdjęcie ≈ 0,04 gr; ponad połowę kosztu robi myślenie (2,4–3,9 tys. tokenów wyjścia). Od v5.14 koszt każdego zapytania w logu (💲) i podział na etapy w Ustawieniach (`ddf_ai_spend.byStage`).

## 4. Decyzje właściciela (nie zmieniać bez pytania)
- AI ma wysyłać okazje; „podejrzanie niska cena / możliwe oszustwo / ukryte wady” to NIE powód do „niepewne” ani „nie” — trafia do pola „Do sprawdzenia”, właściciel weryfikuje sam.
- Ogłoszenie bez ceny → odrzucone od razu, bez AI (wraca, gdy cena się pojawi). Minimalna cena ogłoszenia 200 €.
- Weryfikacja okazji i dokładna analiza niepewnych — wszystkie zdjęcia z ogłoszenia; okazja zweryfikowana tylko z opisu też jest wysyłana (z adnotacją).
- Limit rocznika 2017 dotyczy też dirtów — ale w dircie tylko rocznik PODANY w ogłoszeniu (decyzja 12.11.2026: oszacowany rocznik dirta bywał losowy).
- Dirt bez rocznika i ze słabszym widelcem → dolna granica pasma (ok. 530 €) — zostaje (decyzja 12.11.2026).
- Minimalny zysk zależny od ceny zakupu (decyzja 12.11.2026, v6): 4 progi w Ustawieniach — 200–450, 450–800, 800–1100, 1100–1400 € (granica należy do wyższego przedziału, np. 450 € → 450–800). Próg trafia do części dynamicznej promptu („Minimalny zysk dla tej ceny zakupu”), część stała jest bez liczb (cache). „Opłaca się do” liczone osobno w każdym przedziale (najwyższa cena spełniająca próg SWOJEGO przedziału).
- Przednia przerzutka (Umwerfer, 2x/3x, korba 36/26) w fullu / e-MTB = rower sprzed 2017 (decyzja 12.11.2026). Wyjątek tylko z dowodem w opisie: podany rocznik 2017+ albo — przy modelach z seryjnym 2x później (Fuel EX 9.8 2017–2018, XT 2x11) — wprost „Boost” / „130 mm”. Test 12.11.2026: Fuel EX 9.8 z nocy (przerzutka na zdjęciu) → 2016, Remedy 9 alu → 2012–2016.
- Jeden ogólny link zamiast wyszukiwań modeli — testowany wcześniej, za dużo śmieci → zostają wyszukiwania modeli.
- Dodatkowe dane sprzedawcy/wysyłki/stanu w alertach — na razie nie.
- Widelce w dirtach (dokument „Ściąga: widelce w dirtach”, 11.11.2026): wysoka półka = Pike DJ (tylko 100 mm), Bomber DJ od 2020, Fox 36 831 (zawsze Kashima), Manitou Circus Pro; pasmo „słabszy widelec” = Fox 32 831 (lagi 32 mm, także z Kashimą — decyzja 12.11.2026), Circus Expert/Comp (srebrne lagi = Comp; mostek z tyłu = Manitou), X-Fusion Slant (średnia), Argyle, stare Marzocchi DJ 1–3, Suntour, RST, inne X-Fusion, Sektor/Recon/Judy; nierozpoznany = słabszy; sztywny widelec = rower do odrzucenia. Kashima tylko w Foxie — złote lagi RockShoxa to nie Kashima.
- Test rozpoznawania widelców (11.11.2026): Fox Factory/Kashima pewne; wersje Fox tylko z napisu; ściąga dla Pike DJ: Sonnet 11/11 rowerów (bez niej 1/11), bez fałszywych Pike DJ; ściąga dla fulli (Fox/RockShox wersje) nie pomogła → w fullach tylko zasada „wersja z napisu, inaczej tańsza”. Kolor lag nie mówi o półce.
- Stare notatki cenowe z lipca 2026 (sprzeczne z bazą) — usunięte przez właściciela 11.11.2026.

## 5. Pomysły na później (nie zaczynać bez zgody)
- Wersja serwerowa (bez komputera właściciela): Vercel Hobby pozwala na cron tylko raz dziennie → zewnętrzny zegar (np. cron-job.org) wołający funkcję co minutę albo Vercel Pro; stan zamiast localStorage w bazie (np. Upstash Redis); praca dzielona na krótkie kawałki (limit czasu funkcji); klucze w zmiennych środowiskowych Vercela; strona = tylko panel.
- Dane w alertach: lokalizacja, sprzedawca (prywatny/firma, konto od kiedy, liczba ogłoszeń), wysyłka/odbiór, stan (selektory w p. 2).
- Przypominanie „prawie okazji”, gdy cena spadnie do kwoty „opłaca się do”; historia kupionych/sprzedanych rowerów → notatki cenowe.
- Raport z ChatGPT (audyt v5.11) — przeczytany 12.11.2026; punkty 1–4, 6, 7 wdrożone w v5.14, pkt 5 (rezerwa budżetu) pominięty (budżet 400 zł, wydatki kilka zł). Z propozycji zostają: wycena zapamiętana z kontrolą treści przy spadku ceny, schemat JSON w API (dziś niepotrzebny).
- Wpisy bazy z 12.11.2026 (Remedy 9 alu, Fuel EX 9.8 karbon, Spectral 125 AL) mają „[niska pewność]” — zebrane z ofert zagranicznych (buycycle, finn.no, bikemarkt, velocorner) i cen Canyona; OLX nie był dostępny. Do poprawy własnymi transakcjami. Remedy 9 alu istnieje: 2012–2016 (rower sprzed 2017) + Remedy 9 RSL alu ok. 2018.
- Repo prywatne; ostrzeżenie Node `DEP0169 url.parse()` w `/api/scrape` jest niegroźne (pochodzi ze środowiska Vercela).

## 6. Ryzyka i ograniczenia
- Regulamin Kleinanzeigen (§ 5 pkt 1) zakazuje automatycznego pobierania treści bez zgody — dotyczy całego skanera. Nie przyspieszać odpytywania; blokady mają bezpiecznik.
- Zapytania idą z serwerów Vercela (`/api/scrape`), nie z komputera właściciela.
- Chrome usypia karty w tle (Ustawienia → Wydajność → dodać adres skanera do „zawsze aktywne”); Opera GX ma limity GX Control.
- Testy AI na żywo idą z klucza właściciela (to samo konto co skaner). 11.11.2026 testy zjadły resztę środków Anthropic i skaner stanął — przed większym testem sprawdzić saldo i liczyć koszt (Sonnet ≈ 6 gr / ogłoszenie z 12 zdjęciami).
- Log w aplikacji trzyma ok. 500 linii — od v5.14 bez rutynowych linii na każde wyszukiwanie (wcześniej starczało na ok. 25 min). Do historii: „Dziennik zdarzeń” w Statusie i trwałe „Wyniki” (`ddf_results`, ostatnie 200).

## 7. Historia wersji (skrót)
- v5.4–5.5: Claude Haiku jako dostawca analizy.
- v5.6: kolejka analiz i outbox (nic nie ginie przy błędzie/STOP), reguła 24 h, „Zacznij od zera”, transport 70 € liczony w kodzie, poprawki filtrów.
- v5.7: zdjęcia przy każdej analizie, Sonnet 5.5 do weryfikacji, eskalacje.
- v5.8: wszystkie zdjęcia przy weryfikacji/niepewnych; v5.9: poprawki z audytu (captcha, STOP, zaległe okazje).
- v5.10: brak ceny → odrzucone; podejrzenia → pole „ostrzeżenia” zamiast „niepewne”.
- v5.11: numer ogłoszenia jako ID (+migracja), pamięć 15 000 ogłoszeń wg ostatniego widzenia, min. cena 200 €, bezpiecznik blokad, krytyczne błędy AI, analiza zaraz po wyszukiwaniu, rzadkie wyszukiwania, zdjęcie/rozmiar/„dodano”/obniżka w alercie, komunikaty o problemach, kanał „na granicy”, autozapis ustawień.
- v5.13: ściąga widelców w dirtach, pole „widelec” (alert: 🔧 Widelec), sztywny widelec → odrzucone, wszystkie zdjęcia przy dirtach, poprawiona reguła Kashimy, nowe półki widelców w bazie dirtów, wróciło „📷 Zdjęcia” w „na granicy”.
- v6.0: minimalny zysk (%) w 4 przedziałach ceny zakupu (Ustawienia → Strategia), migracja z jednego progu.
- v5.15: przednia przerzutka = rower sprzed 2017 (z wyjątkami tylko z dowodem w opisie), wpisy bazy: Trek Remedy 9 alu, Fuel EX 9.8 karbon (z bike checkami), Canyon Spectral 125 AL 5/6.
- v5.14 (audyt 12.11.2026): Groq a kompletny rower w wyszukiwaniach marek, dirt rozpoznany przez AI → powtórka z bazą dirtów, widelec bez modelu, rocznik dirta tylko podany, „opłaca się do”, jedna próba na cykl + odstępy + przerwa po awarii AI, wznowienie od weryfikacji, zmiana treści zaległej okazji, brak ceny na stronie ogłoszenia, duplikaty alertów, lokalizacja z nowego układu, trwałe Wyniki, koszt każdego zapytania i podział na etapy, krótszy log, pełniejszy tekst awaryjny Discorda, STOP przy 400, Fox 32 831, przednia przerzutka = rocznik sprzed 2017, „absolut” tylko z „commencal”.
- v5.12: odstęp 6 s, typ Mountainbike + E-Bike, usunięte ogłoszenia, poprawki Groqa (dirty, dłuższy opis, ostrożniej ze „stary”), nowe progi „na granicy”, alerty bez powtórzeń i po polsku, rocznik jako zakres, dziennik zdarzeń, autostart.
