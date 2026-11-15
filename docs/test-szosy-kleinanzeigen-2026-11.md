# Test toru szos i graveli na prawdziwych ogłoszeniach — Kleinanzeigen, 15.11.2026

Etap 3 wdrożenia szos i graveli. Test zrobiony **bez klucza AI**: ogłoszenia zebrane wbudowaną przeglądarką prosto z kleinanzeigen.de, filtry policzone tak jak w aplikacji, a 30 ogłoszeń ocenionych ręcznie według bazy `KB_ROAD` (zamiast Haiku / Sonneta). Test z prawdziwym AI wymaga kluczy z przeglądarki właściciela — patrz „Co zostało”.

## 1. Zebrane dane
- pierwsze strony wszystkich 41 wyszukiwań toru szos (200–800 €): **780 różnych ogłoszeń**, żadnej blokady, żadnej karty bez ceny
- liczba wyników na wyszukiwanie: ogólne 128–2028 („Rennrad Carbon” 2028, „Gravel” 704), modele 3–230 (np. Canyon Endurace 48, Cube Attain 98, Trek Checkpoint 3)

## 2. Darmowe filtry (lista słów z v6.16, słowa retro, rok w tytule)
- odrzucone 138 z 780 (18%): słowa 104 (najczęściej Rahmenset 31, Laufradsatz 8, Cockpit 7), retro 19, rok < 2014: 15
- do Groqa przeszłoby 642; wśród nich nadal **same części i rowery uszkodzone**: sztyce, kierownice, widelce, „Rahmen Set”, „Carbonrahmen”, „Rennrad-Rahmen”, „Rahmen defekt”, „Rahmenbruch … als Teilesatz”
- → v6.18: lista słów rozszerzona (prawdziwe tytuły są w `tests/tests6180.mjs`). Samych słów „Rahmen” i „Gabel” nie dodano — „56 cm Rahmen”, „Alu-Rahmen, Carbon-Gabel” to opisy całych rowerów.

## 3. Ceny w Niemczech a w Polsce (zgrubnie, z tytułu i początku opisu)
Mediana cen ofertowych w Niemczech (tylko oferty 200–800 €) i wycena z bazy:

| Segment | Ofert | Mediana DE | Pasmo PL z bazy |
|---|---|---|---|
| szosa alu, hamulce szczękowe | 248 | 550 € | 1300–2400 zł (≈300–550 €) |
| szosa karbon, hamulce szczękowe | 176 | 600 € | 2500–4150 zł (≈575–955 €) |
| szosa alu, tarczowe | 16 | 700 € | 2050–4250 zł (≈470–975 €) |
| gravel alu, hamulce mechaniczne lub nieustalone | 162 | 699 € | 2000–2550 zł (≈460–585 €) |
| gravel alu, hamulce hydrauliczne | 13 | 750 € | 3300–4000 zł (≈760–920 €) |

**Wniosek:** w szosach i gravelach do 800 € ceny w Niemczech są zbliżone do polskich albo wyższe. Nie ma tu stałej różnicy cen jak w MTB — okazją jest tylko ogłoszenie wyraźnie poniżej rynku, a takie są rzadkie. Podział na segmenty jest przybliżony (wyrażenia regularne na tytule), liczby pokazują kierunek, nie dokładną wartość.

## 4. 30 ogłoszeń ocenionych ręcznie
Wybrane: 30 ogłoszeń o największym „zysku z liczb” (zgrubna wycena z tytułu), po odsianiu oczywistych części. Do każdego pobrany pełny opis.

| Wynik | Liczba | Przykłady |
|---|---|---|
| rower sprzed 2014 (odrzucenie) | 20 | Giant TCR Composite / Advanced C2, Giant Defy Ultegra 3x10, Cube Litening Super HPC (Ultegra 6600), Cube Agree GTC (ST-6700, 3x10), Canyon Ultimate F10 (Ultegra 9-fach), Merida Scultura Evo 905 (10 zębatek), Scott Speedster S30 (3x10), Rose „Red Bull”, Cannondale Synapse Carbon 3x10, Bergamont Prime CX (ST-5700), Principia 700 |
| sama rama / część | 1 | Cannondale SuperX — „es wird lediglich der Rahmen verkauft” |
| inny typ | 1 | Stevens „ohne Gang” (jeden bieg) |
| za mało opisu | 3 | „Gravel Bike Trek” (jedno zdanie), Bulls 600 Ultegra, Giant Revolt „Carbon/Alu” bez osprzętu |
| nowszy rower, ale bez zysku | 5 | Cube Nuroad Pro 2024 za 700 €, Trek Domane AL 2 Disc za 725 €, Cannondale Topstone 3 za 550 €, Cube Attain GTC SL Disc Ultegra za 800 € (z wpisu modelu zysk ok. 15%), Trek Domane SL Disc 2019 z napędem Sensah za 699 € |
| **prawdziwa okazja** | **0** | — |

**Wnioski i co zmieniono w v6.18:**
1. Największe ryzyko to **stare karbonowe szosy bez rocznika w opisie** („Carbon, Ultegra” z lat 2005–2013 za 300–500 €). Z samych liczb wyglądają na okazje z zyskiem 60–200%.
   - program: decyzja „tak” bez ustalonego rocznika → „niepewne” (nie okazja), z wpisem „brak dowodu rocznika 2014+” w „Do sprawdzenia”
   - baza: sekcja „DOWÓD ROCZNIKA 2014+” (rok w ogłoszeniu, 11 / 12 biegów, numer serii, tarcze, model z 2014+) i lista dowodów roweru sprzed 2014 (Ultegra / 105 / Dura-Ace 9- i 10-rzędowe, ST-5600…6700, 3x, „dem Alter entsprechend”)
   - baza: sekcja „STARSZE GENERACJE” — nazwy modeli sprzed 2014 (TCR Composite, Ultimate F10, Litening HPC, Agree GTC, Speedster S30, Scultura Evo 90x, „Red Bull”, CAAD3–9…)
   - Groq: te same dowody jako podstawa odpowiedzi „stary”
2. „Hydraulische Bremsen Magura RT8” (Specialized Tarmac za 430 €) to hamulce hydrauliczne **na obręcz** — dopisane jako szczękowe.
3. „Alu Carbon Rennrad” z karbonowymi widełkami tylnymi to rama alu — dopisane.
4. Rower przebudowany na tani napęd (Trek Domane SL z Sensah) — dopisane: pasmo jak dla Claris / Sory.
5. Wpis modelu ma pierwszeństwo przed tabelą kategorii — na Cube Attain GTC SL Disc dało to „bez zysku” zamiast fałszywej okazji. Zostaje.

## 5. Co zostało
- **Test z prawdziwym AI** (Haiku + Sonnet, zdjęcia): możliwy dopiero w przeglądarce właściciela, gdzie są klucze. Po włączeniu przełącznika warto po 1–2 dniach przejrzeć zakładkę Wyniki i kanały Discorda pod kątem: czy Groq dobrze odsiewa stare rowery, czy AI podaje rocznik z dowodem, ile ofert trafia do niepewnych.
- Kalibracja pasm na pierwszych prawdziwych sprzedażach.
- Nocne szukanie „za drogich” i podgląd bazy szos w zakładce „Baza” — niezrobione.
