# Plan: ocena trafności alertów i monitor rynku PL (ustalenia 20–21.11.2026)

**Status: plan — nic z tego nie jest wdrożone.** Kod dopiero po decyzjach z sekcji 4 i poleceniu właściciela („rób”), jak zawsze na osobnej gałęzi z PR.

Kolejność: (1) wyszukiwania e-MTB — v6.23, osobny PR; (2) ocena trafności alertów; (3) monitor rynku PL. Oba pomysły się łączą: alerty z oceną 💸 („wycena za wysoka”) wskazują wpisy bazy, które monitor ma sprawdzić najpierw.

**Konto:** monitor wymaga zaplanowanych zadań, a te są tylko w planach płatnych. Darmowy plan ich nie ma, nie ma też Claude Code, Cowork ani Claude in Chrome. Dalsza praca idzie na drugim koncie z Pro. Na nim trzeba: połączyć GitHub, zalogować aplikację Claude na komputerze (przez nią działają wbudowana przeglądarka i zaplanowane zadania) i, jeśli Claude ma czytać kartę skanera, także Claude in Chrome. Sam skaner nie zależy od planu Claude — działa na Vercelu i kluczach API właściciela.

## 1. Ocena trafności alertów (wersja po v6.23)

**Cel:** wiedzieć, ile „okazji” jest prawdziwych i gdzie AI się myli, i ustawiać progi oraz reguły na podstawie danych, a nie na wyczucie.

**Jak właściciel ocenia**
- **Reakcją pod alertem na Discordzie (telefon)** — główna droga. Bot sam dodaje pod alertem zestaw reakcji, wystarczy kliknąć.
  - okazja: 👍 trafiona · 👎 nietrafiona · 📅 zły rocznik · 💸 wycena za wysoka · 🔧 źle rozpoznana rama / widelec / osprzęt · ⏱️ sprzedany, zanim zdążyłem · ✅ kupiłem
  - na granicy: 🤝 przyjął propozycję · ❌ odmówił · 🔇 nie odpisał · 👎 nie warto było pisać
- **Przyciski w zakładce Wyniki** — te same oceny plus notatka. Tylko tu da się oznaczyć „❌ NIE”, które było okazją (przegapione), bo takie oferty nie trafiają na Discorda.
- Lista „niepewnych” to jedna wiadomość na cykl (wiele ofert naraz), więc reakcje jej nie dotyczą — tylko zakładka Wyniki.

**Jak to działa**
- Wysyłka alertu (okazja, szosa, na granicy) z `?wait=true` — Discord odsyła numer wiadomości i kanału. Zapis w nowym `ddf_feedback` (po numerze ogłoszenia), razem z liczbami z chwili alertu: cena, wycena, zysk, próg, typ, rocznik, model AI, weryfikacja, wpisy bazy, wersja programu. Osobno od `ddf_results`, więc „Wyczyść” i limit 200 go nie kasują.
- Co ok. 10 min skaner czyta reakcje: `GET /channels/<id>/messages?limit=100` — jedno zapytanie na kanał (okazje, szosy, na granicy). `/api/discord` dostaje nową wąską akcję: tylko odczyt wiadomości z kanału o podanym numerze, token bota w nagłówku. Liczą się reakcje wszystkich osób poza botem.
- **Do dopisania:** dziś wynik analizy nie zapisuje, który model AI go wydał (nazwa jest tylko w logu) ani które wpisy bazy dołączono (`kbIds` żyją tylko przy budowie promptu). Nowe pola, np. `_ai`, `_aiVerify`, `_kb` — bez nich nie da się porównać Haiku z GPT-6.1 Terra ani znaleźć wpisu bazy, który zawyża.
- **Statystyki** na górze Wyników: trafność okazji (% 👍), najczęstsze powody 👎, skuteczność propozycji „na granicy” (🤝 na wszystkie napisane), w podziale na model AI, weryfikację Sonnetem, typ roweru, przedział ceny (4 progi) i markę / wpis bazy; przy małej liczbie ocen dopisek „mało danych”. Przycisk „Eksportuj oceny” (JSON) — do analizy i do przeniesienia na serwer.
- Logika (mapowanie reakcji, statystyki, zapis, limity) jako czyste funkcje na górze `index.html` → przy przenoszeniu na serwer wystarczy dopisać je w `tools/sync-core.mjs` (bikefinder70), więc zaległość przy przebudowie praktycznie nie rośnie.
- Pamięć: ok. 0,5 KB na alert; nieocenione alerty 30 dni, ocenione do ok. 2000. Przed kodowaniem sprawdzić zajętość localStorage w karcie skanera (sam odczyt).
- Testy: atrapa Discorda z reakcjami i `wait=true`, pośrednik przepuszcza tylko dozwolony adres, statystyki na danych testowych, przyciski w Wynikach.

**Właściciel, raz (ok. 5 min):** Discord Developer Portal → nowa aplikacja → Bot → token; zaproszenie bota na serwer z uprawnieniami „View Channel”, „Read Message History” i „Add Reactions” na kanałach okazji (i szos) oraz „na granicy”; token wkleić w Ustawieniach (zostaje w localStorage, jak inne klucze). Uprawnienie Message Content NIE jest potrzebne — według dokumentacji Discorda obejmuje tylko treść, osadzenia, załączniki, komponenty i ankiety; reakcje i numery wiadomości są widoczne bez niego. Bez bota zostają same przyciski w Wynikach.

## 2. Monitor rynku PL (OLX)

**Cel:** świeże pasma cen we wpisach bazy, zmierzona płynność (jak długo wiszą ogłoszenia i ile znika) i raport z propozycjami zmian w bazie. `docs/ceny-szosy-olx-2026-11.md` sam zaznacza, że długo wiszące rowery zawyżają rozkład — z kolejnych migawek da się liczyć osobno ceny ogłoszeń, które zeszły szybko. Pola „płynność” i „dane: n=…” we wpisach bazy, dziś wpisywane ręcznie, wyjdą z danych.

**Kto i jak**
- Zaplanowane zadanie (drugie konto z Pro), codziennie np. o 20:00: nowa sesja Claude steruje wbudowaną przeglądarką w aplikacji Claude na komputerze właściciela. Bez logowania na konto OLX; skaner w Chrome działa bez zmian.
- Ludzkie tempo (kilka sekund na stronę). Weryfikacja „czy jesteś człowiekiem” → sesja staje i daje znać, nie obchodzi jej. Komputer / aplikacja wyłączone → porcja przechodzi na następny dzień.
- Zakres: **wszystkie wyszukiwania skanera** (MTB; od v6.23 z e-MTB), każde raz w tygodniu, w codziennych porcjach po ok. 25–30 stron (5–10 min). Szosy opcjonalnie.
- Z każdej karty: numer ogłoszenia (z linku `/d/oferta/…-ID<numer>.html`), tytuł, cena, „do negocjacji”, stan, miasto, data albo „Odświeżono”, znacznik promowanego. Bez nazw sprzedawców i opisów. Porównanie z odczytem sprzed tygodnia: nowe, zniknięte (≈ sprzedane albo zdjęte), obniżki, odświeżenia.
- Raz w tygodniu (niedziela) skrypt w `tools/` (z testami) liczy dla każdego wpisu bazy: liczbę ofert, p25 / medianę / p75, zmianę od poprzedniej migawki, ile zniknęło i po jakich cenach, jak długo wiszą pozostałe i ile jest odświeżanych. Claude otwiera PR z raportem i propozycjami zmian w bazie (tylko przy rozjeździe ponad ok. 10–15% i wystarczającej liczbie ofert); właściciel dostaje powiadomienie i klika Merge.
- Kiedy wyniki: ceny po pierwszej migawce, dane o znikaniu po drugiej, wiarygodna płynność głównych modeli po ok. 2 miesiącach.
- Bez analizy AI ogłoszeń (zero kosztów API), bez alertów i bez pisania do sprzedawców. Sesje zużywają limit subskrypcji.

**Pomiary na żywo (20.11.2026, OLX, kategoria Rowery, od 1500 zł)**
- 45 wyszukiwań MTB bez filtrów ≈ 245 stron po 40 ogłoszeń. Prawie połowa (ok. 117) to szerokie wyszukiwania: Giant, Dartmoor i „Dirt” (każde ponad 1000), NS Bikes 936, Marin 692 — głównie hardtaile, miejskie, dziecięce, części.
- Wąskie wyszukiwania (Raaw, Beddo, Radon Slush, Trek Ticket, „Dirtbike”) prawie nic nie dają — OLX dopełnia wtedy wyniki do ok. 70 luźno pasujących ogłoszeń; czytać tylko do miejsca, gdzie wyniki przestają pasować do modelu.
- Z filtrami (podkategoria, amortyzacja „przód i tył” przy całych markach, filtr marki zamiast tekstu, przerwanie po niepasujących) szacunek 120–150 stron na pełny przegląd MTB; szosy dodatkowo ok. 60–80 (skala z 15.11). Dla dirtów zamiast ogólnego „dirt” węższe frazy (np. „dirt jump”, „dirtówka”) — do sprawdzenia.
- Na stronie wyników: 40 ogłoszeń; odświeżone pokazują tylko „Odświeżono dnia…” (bez daty dodania) → czas wiszenia z porównania migawek; promowane bywają pokazane podwójnie → liczyć po numerze; filtr ceny w adresie `?search%5Bfilter_float_price%3Afrom%5D=1500`; filtry w panelu: materiał ramy, typ hamulca, rozmiar koła i ramy, amortyzacja, stan, prywatne / firmowe.
- Przy okazji: Cube Stereo na OLX to w dwóch trzecich elektryki (312 z 464), Focus Jam w ponad połowie (72 ze 127).
- Odczyt przez wewnętrzne API OLX (`/api/v1/offers/`) zablokowały zabezpieczenia sesji Claude → monitor czyta zwykłe strony wyników, jak człowiek.

**Regulamin:** dokładnego zapisu OLX.pl nie znaleziono; regulamin Otodom (serwis tej samej Grupy OLX) zabrania korzystania z treści bez pisemnej zgody i agregowania danych z serwisu w celu udostępniania ich innym w innych serwisach. Dlatego: tylko na własny użytek, ludzkie tempo, surowe dane prywatnie, a do publicznego repo wyłącznie zbiorcze liczby (jak w `ceny-szosy-olx-2026-11.md`).

## 3. Co się zmieni w plikach (szkic)

- Ocena alertów: `public/index.html` (wysyłka z `wait=true`, `ddf_feedback`, odczyt reakcji, przyciski i statystyki w Wynikach, nowe pola analizy, token bota w Ustawieniach), `api/discord.js` (akcja odczytu wiadomości kanału), nowy plik testów.
- Monitor: `tools/rynek/` — lista zapytań powiązanych z wpisami bazy, format migawki (JSONL), skrypt raportu z testami; raporty zbiorcze w `docs/`; zaplanowane zadanie na koncie z Pro. Skaner bez zmian.

## 4. Do decyzji właściciela

1. **Bot Discorda** — zakładamy (oceny z telefonu, polecane), czy na start tylko przyciski w Wynikach?
2. **Zestaw reakcji** — jak wyżej, czy zmiany?
3. **`kb_build.py`** — źródła bazy MTB nie ma w repo (`index.html`: „nie edytuj ręcznie, popraw plik bazy”). Wrzucić je do repo (PR monitora poprawia źródło), czy od teraz źródłem jest `index.html`?
4. **Surowe dane z OLX** — prywatne repo (nowe, np. `bikefinder-rynek`, albo puste prywatne `bikefinder70server`) czy folder na komputerze właściciela?
5. **Szosy w monitorze** — tak / na razie tylko MTB?
6. **Godzina codziennej porcji** — proponowana 20:00 (komputer i aplikacja Claude muszą być wtedy włączone).
