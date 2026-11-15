# Ceny szos i graveli w Polsce — OLX, 15.11.2026

Źródło liczb w bazie `KB_ROAD` (blok `ROAD` w `public/index.html`). Zebrane 15.11.2026 z wyszukiwarki OLX.pl: po ok. 1100–1200 najnowszych ofert z kategorii „Rowery szosowe” i „Gravel” oraz do 100 ofert na każde z 62 zapytań o model / markę (razem 2322 oferty po odsianiu).

**Odsiew:** tylko oferty prywatne, stan „używane” albo „jak nowe”, cena 700–30 000 zł, bez rowerów elektrycznych, samych ram i kół. Materiał ramy i rodzaj hamulców — z pól ogłoszenia OLX; grupa osprzętu i rocznik — z tytułu i opisu (wyrażenia regularne, więc część ofert ma grupę „?”).

**Jak czytać:** `p25 / mediana / p75` cen OFERTOWYCH w zł. Baza przyjmuje jako ostrożną cenę sprzedaży pasmo **p25–mediana** (ceny ofertowe są zwykle wyższe niż transakcyjne). `n` = liczba ofert; przy n < 6 wpis w bazie ma oznaczenie [niska pewność].

Kombinacje: rama K = karbon, A = alu; hamulce H = tarczowe hydrauliczne, M = tarczowe mechaniczne, S = szczękowe; `?` = nie podano.

## Modele (klucz: n, wszystkie wersje p25/mediana/p75 | kombinacje)

```
endurace: n=51 all 4400/6000/8250 | KH n22 7000/8250/10050 | AH n8 4350/4500/5200 | KS n5 4500/5000/5200 | ?? n5 1800/2750/4200 | A? n3 3850/4400/5900 | AS n3 2500/2900/3050
ultimate: n=35 all 6200/8000/10550 | KH n16 8400/9950/11450 | KS n11 3950/5500/6750 | K? n6 7750/8000/9500
aeroad: n=24 all 7800/13100/17150 | KH n16 11350/14450/17150 | K? n5 6500/7000/19500 | KS n3 7150/7200/7600
attain: n=48 all 2600/3600/4550 | KH n12 4200/4400/4800 | K? n8 3500/4050/4700 | ?? n6 2100/2550/3300 | AM n6 2500/2550/3050 | AH n5 3300/3550/5200 | AS n5 1700/2500/2700 | KS n3 2950/3050/4350
agree: n=34 all 2650/3150/4900 | KS n13 2600/2950/3300 | K? n8 3300/3850/4150 | KH n7 5050/7450/8850 | AS n4 2000/2550/2850
litening: n=10 all 4100/8900/13650 | KH n6 8850/11950/16300 | KS n3 2200/2400/6200
tcr: n=62 all 2900/4100/7250 | KS n20 2600/3400/4500 | K? n19 3250/4000/5000 | KH n15 9000/9900/11000 | AS n3 2200/2400/2600 | A? n3 1500/1900/2450
defy: n=47 all 1650/2550/4500 | AS n17 1500/1800/2150 | KH n10 5100/6650/7000 | ?? n7 1850/2550/3100 | A? n4 1600/1900/2350 | K? n4 4150/5900/7850 | KS n3 2000/2350/4450
contend: n=55 all 2100/2750/3500 | AS n15 1950/2100/2700 | AH n14 2950/3700/4750 | AM n7 2800/3000/3400 | A? n6 2250/2500/2600 | ?? n5 1400/1500/1800 | K? n3 2650/3250/3550
propel: n=41 all 4700/9000/12000 | KH n20 9850/11250/13600 | KS n12 3850/4100/4850 | K? n7 7850/12000/13850
emonda: n=67 all 4950/7000/10700 | KH n28 7250/9200/12100 | KS n16 3500/4350/5550 | K? n15 5050/6900/14250 | ?? n3 4750/5500/6150
domane: n=64 all 2550/3950/6750 | AS n15 2000/2500/2600 | ?? n11 3550/4300/6500 | KH n11 8750/9500/9950 | AH n6 4450/4500/5250 | KS n5 3000/3950/4200 | ?H n4 4400/5700/6750 | AM n4 2650/2650/2700
madone: n=49 all 5250/10000/15000 | KH n20 11300/14450/19250 | KS n13 3000/5250/6800 | K? n7 3250/8500/13250 | ?? n5 7500/7500/11000
allez: n=61 all 2000/2400/3200 | AS n28 1950/2200/3150 | ?? n16 2500/2650/3750 | A? n11 1650/2000/2250
tarmac: n=39 all 3750/6650/12400 | KS n14 3150/3500/4450 | KH n14 6950/10750/20000 | ?? n6 4550/8250/18500 | K? n4 3900/8650/12900
roubaix: n=42 all 3600/5000/7750 | KH n19 5600/6900/9950 | KS n11 2950/3500/4100 | K? n6 2450/2550/3800 | ?? n5 4900/9500/14000
caad: n=29 all 2000/2600/3600 | AS n13 2100/2600/3600 | ?? n7 1700/2200/2950 | AH n6 3150/3600/3750
synapse: n=21 all 3900/4500/6000 | KH n9 5000/5700/6700 | KS n4 3350/4000/4500
supersix: n=22 all 3850/6350/7700 | KS n13 3750/4500/6500 | KH n6 7000/7600/11900
addict: n=45 all 6400/8000/10500 | KH n28 6850/8400/12000 | K? n7 7000/7000/8250 | KS n6 3100/4750/5500 | ?? n3 6250/8500/9000
speedster: n=83 all 2000/2900/4250 | AS n24 1500/1800/2300 | AH n24 3850/4250/5400 | AM n11 2550/2800/3250 | ?? n10 2650/3050/4000 | A? n4 3350/4300/4800 | ?H n3 3850/4700/4750
foil: n=32 all 5900/8100/12550 | KH n14 7200/8750/12550 | KS n8 5200/6150/9000 | K? n7 4750/7000/10300
izalco: n=58 all 4000/5950/8500 | KS n26 3900/4200/5500 | KH n19 7450/10000/12500 | K? n5 5300/6000/8500 | ?? n3 8000/12650/16850 | AS n3 2750/2900/2950
scultura: n=48 all 2100/2900/3950 | AS n18 1800/2200/2850 | ?? n7 1750/2000/2600 | KS n5 2900/2900/3700 | KH n5 7900/8500/17000 | K? n4 3250/5150/10250 | A? n3 1950/2100/2450
reacto: n=42 all 3700/7050/11550 | KH n15 8150/12500/14050 | AS n11 3000/3500/3900 | ?? n4 4100/7100/10550 | KS n4 6650/7050/7350 | K? n3 3800/4400/6700
teammachine: n=29 all 5000/6500/11000 | KH n12 7650/11250/13400 | KS n10 3500/4500/6300 | ?? n3 5750/6750/6850
bianchi: n=27 all 4000/7700/11750 | KH n12 7650/9750/13100 | K? n6 5800/8050/9250 | KS n3 2350/2650/3450
rose_prosl: n=11 all 2600/3000/3750 | AS n5 2350/2400/3300
triban: n=75 all 1000/1800/2500 | AS n25 950/1100/1600 | ?? n17 900/2000/2200 | AM n11 1700/2500/3000 | AH n11 2100/2500/3000 | A? n8 1750/2150/2400 | ?S n3 800/900/1000
vanrysel: n=11 all 3950/5500/8750 | KH n7 5750/8000/10250
orca: n=40 all 6000/9150/12250 | KH n20 9250/10000/13100 | KS n10 4000/5400/6400 | K? n5 9500/13000/14900 | ?? n4 7800/8850/10200
grail: n=46 all 5650/7100/8500 | KH n23 7350/8500/10450 | K? n9 6000/6600/8000 | AH n9 4500/4900/5200
grizl: n=48 all 5750/6700/8200 | KH n21 6800/8100/9500 | AH n16 5400/6000/6700 | ?? n5 4900/5600/6150 | K? n3 6750/7000/10500
inflite: n=11 all 5250/7000/8000 | KH n7 5300/7000/8000
nuroad: n=51 all 3400/3900/4650 | AH n25 3700/4000/4600 | AM n8 3050/3300/3450 | KH n7 4950/5900/6350 | ?? n3 2300/2600/2800 | ?H n3 3850/4200/4250
crossrace: n=22 all 2900/3500/5250 | KH n6 4900/6850/8100 | AM n6 2750/3050/3650 | AH n4 4150/4850/5600 | ?? n4 2900/2950/3000
backroad: n=29 all 4600/6000/7400 | AH n8 5600/6000/6000 | KH n6 7600/10350/12950 | ?? n6 3900/4150/4450 | K? n4 6500/7200/9300 | ?H n4 4000/4300/4600
revolt: n=32 all 3700/4350/5900 | AH n11 3600/4150/4950 | KH n8 5850/6200/7700 | AM n5 2600/3000/3800 | A? n3 2900/3000/3600
tcx: n=14 all 2700/3950/7300 | AH n4 3200/3600/4100 | ?? n3 2550/2600/4600 | KH n3 7600/7700/8350
checkpoint: n=41 all 4800/8900/13400 | KH n22 8900/13000/14950 | AH n6 4600/5000/5200 | ?? n5 4700/5500/11500 | AM n4 3700/4250/4600
diverge: n=54 all 3800/5500/8150 | KH n19 6250/7900/12000 | AH n12 4000/4750/5700 | AM n11 2900/3500/3800 | ?? n5 3800/6000/6200 | K? n4 7700/8550/9300 | A? n3 3050/4000/4500
crux: n=10 all 6000/6800/9100 | KH n6 5550/7000/9100
topstone: n=26 all 3800/4950/8250 | KH n10 8150/8850/10750 | AH n8 3650/4200/4500 | AM n3 3750/3800/3900
silex: n=27 all 3600/4300/4850 | AH n15 4000/4500/4600 | KH n3 5750/6500/7250 | A? n3 3100/3500/4050
atlas: n=31 all 4000/4500/6250 | AH n15 3900/4200/5000 | ?? n6 3550/4600/5100 | KH n4 6800/8400/10750 | A? n3 3850/4300/4300
mares: n=9 all 2200/3400/4350 | 
nicasio: n=13 all 1900/2200/2500 | ?M n9 1900/1900/2300
gestalt: n=22 all 2300/2850/3000 | AM n9 2150/2300/3000 | AH n7 2950/3000/3550 | ?? n3 2650/3000/4750
rove: n=7 all 1600/2300/3100 | AM n4 2100/2400/2850
terra: n=17 all 5000/5500/8500 | AH n10 4850/5000/5400 | KH n5 8500/9000/10000
jari: n=13 all 2850/4000/4800 | AH n3 3750/4800/4800 | AM n3 2700/2850/3500
grandurance: n=14 all 2450/3050/3950 | AM n4 2500/2600/2750 | AH n4 2900/3650/4250
ridley: n=30 all 3400/4050/6150 | KH n11 4950/6000/7850 | KS n6 2750/3650/4100 | AH n4 3400/3750/4250 | K? n4 3850/5950/8450
wilier: n=18 all 1800/3900/8250 | KS n6 2050/3100/4550 | KH n4 8550/9450/13750 | K? n3 3900/4000/11350 | AS n3 1200/1600/1700
radon: n=5 all 2050/2500/2600 | 
stevens: n=11 all 2400/4400/5700 | KH n4 5450/5700/7400
bulls: n=7 all 1550/2000/2650 | AM n4 1800/2450/3000
avant: n=21 all 3000/3850/4800 | AM n5 2900/3800/3850 | AH n4 4400/4650/5900 | AS n3 1900/2200/2600 | KH n3 5350/5900/6700 | ?? n3 3400/3500/3650
felt: n=13 all 2400/4000/5000 | KH n3 6000/8000/12850 | AM n3 2100/2400/2500
cervelo: n=21 all 5000/10000/15900 | KS n6 3950/5500/6750 | K? n5 8900/10900/11500 | KH n5 14000/19600/20900 | ?? n4 4100/7250/12500
```

## Kategorie: typ | rama | hamulce | grupa osprzętu (S = szosa, G = gravel; bez przerzutek elektronicznych, bez ofert z podanym rocznikiem < 2014)

```
G|alu|hydr|105: n=8 3450/3850/4000
G|alu|hydr|?: n=50 3350/3800/4500
G|alu|hydr|apex: n=18 3000/3350/4150
G|alu|hydr|grx400: n=8 3400/3550/3950
G|alu|hydr|grx800: n=10 4100/4400/4850
G|alu|hydr|grx?: n=49 3500/4000/4700
G|alu|hydr|tiagra: n=5 3300/3500/3800
G|alu|mech|?: n=32 1850/2550/3150
G|alu|mech|apex: n=5 2550/3100/3200
G|alu|mech|budget: n=6 2000/2350/2900
G|alu|mech|claris: n=17 2000/2000/3000
G|alu|mech|grx?: n=5 2600/3200/3500
G|alu|mech|sora: n=13 2200/2200/2900
G|alu|mech|tiagra: n=6 2250/2550/2900
G|karbon|hydr|?: n=19 6250/8000/9500
G|karbon|hydr|apex: n=5 5950/6000/7000
G|karbon|hydr|grx?: n=28 5500/6000/7750
G|karbon|hydr|rival: n=6 5900/7300/9350
S|alu|hydr|105: n=8 3700/4250/5400
S|alu|hydr|sora: n=5 1800/1950/2100
S|alu|mech|?: n=9 1050/1500/2500
S|alu|szczek|105: n=15 1950/2400/2900
S|alu|szczek|?: n=37 1300/1500/1950
S|alu|szczek|sora: n=10 1100/1550/1800
S|alu|szczek|tiagra: n=10 1300/1500/1650
S|alu|szczek|ultegra: n=12 1100/2000/2500
S|karbon|hydr|105: n=20 4850/5850/7250
S|karbon|hydr|?: n=17 5500/7300/11500
S|karbon|hydr|ultegra: n=17 5300/6750/8400
S|karbon|szczek|105: n=24 2500/3000/4000
S|karbon|szczek|?: n=11 2350/3000/3650
S|karbon|szczek|campa: n=9 2200/3000/6500
S|karbon|szczek|duraace: n=18 3350/4300/7750
S|karbon|szczek|ultegra: n=22 3400/4150/5450
S|stal|szczek|?: n=14 1250/1400/2350
```

## Rama × hamulce (wszystkie grupy razem)

```
G|alu|hydr: n=166 3300/3850/4500
G|alu|mech: n=87 2000/2550/3050
G|karbon|hydr: n=105 5950/7700/10000
G|stal|hydr: n=8 3400/3800/4850
G|stal|mech: n=8 1700/1950/2800
S|alu|hydr: n=23 2050/3250/3950
S|alu|mech: n=24 1500/2450/3000
S|alu|szczek: n=101 1300/1550/2200
S|karbon|hydr: n=120 6150/8950/13300
S|karbon|szczek: n=103 2800/4000/5500
S|stal|szczek: n=17 1200/1400/2400
```

## Wpływ rocznika (tylko oferty z rocznikiem podanym w tytule albo opisie)

```
G|alu|hydr|2018-20: n=7 2700/3500/3850
G|alu|hydr|2021+: n=63 3450/4000/4750
G|alu|mech|2021+: n=26 2200/2850/3400
G|karbon|hydr|2021+: n=52 6950/8000/10650
S|alu|hydr|2021+: n=8 3400/3500/4150
S|alu|mech|2021+: n=7 2350/2700/3050
S|alu|szczek|2021+: n=7 1350/1450/1800
S|karbon|hydr|2018-20: n=12 4750/6000/7000
S|karbon|hydr|2021+: n=55 7200/10700/14000
S|karbon|szczek|2014-17: n=5 3400/4000/5200
S|karbon|szczek|2018-20: n=8 4000/5900/6550
S|karbon|szczek|2021+: n=7 4250/5000/9450
```

## Ograniczenia

- To ceny ofertowe z jednego dnia, nie transakcje; rowery wiszące długo zawyżają rozkład.
- Pule modeli mieszają roczniki (np. „karbon, tarczowe” to głównie rowery z lat 2020+).
- Rozpoznanie grupy osprzętu i rocznika z tekstu jest przybliżone; małe próby (n < 6) są niepewne.
- Do kalibracji w etapie 3: porównanie z rzeczywistymi sprzedażami właściciela i z cenami w Niemczech.
