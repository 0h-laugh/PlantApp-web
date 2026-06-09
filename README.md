# 🪴 PlantApp — faza „sam aparat" (v1.0)

Asystent pielęgnacji roślin domowych. PWA — instaluje się na Androidzie jak normalna aplikacja, działa offline (poza identyfikacją AI).

## Co umie
- **Skanuj** — zdjęcie rośliny → Pl@ntNet AI rozpoznaje gatunek → dodajesz do kolekcji z automatycznym planem podlewania (inny interwał lato/zima, ~55 popularnych roślin w bazie, reszta z planem domyślnym do ręcznego dostrojenia)
- **Rośliny** — lista z pierścieniem odliczającym dni do podlewania, przycisk „Podlałem/am", historia, porady (światło, wilgotność, toksyczność dla zwierząt)
- **Doktor** — dwa tryby: zdjęcie zmiany → Pl@ntNet rozpoznaje chorobę/szkodnika (mszyce, przędziorek, mączniak…), albo offline'owy przewodnik po 15 najczęstszych objawach z planem działania
- **Przypomnienia** — powiadomienie przy otwarciu aplikacji, gdy coś czeka na podlanie
- **Kopia danych** — eksport/import JSON (dane trzymane tylko lokalnie na telefonie)

## Wdrożenie na prod (GitHub Pages — 5 minut, darmowe, HTTPS)

Masz już repo `github.com/0h-laugh/PlantApp`. Wrzuć tam te pliki:

```bash
git clone https://github.com/0h-laugh/PlantApp
cd PlantApp
# skopiuj tu zawartość tego folderu (index.html, app.js, care-db.js, styles.css, sw.js, manifest.json, icons/)
git add .
git commit -m "PlantApp v1.0 — PWA camera phase"
git push
```

Potem na GitHubie: **Settings → Pages → Source: Deploy from a branch → Branch: main, folder: / (root) → Save.**

Po ~2 minutach aplikacja działa pod `https://0h-laugh.github.io/PlantApp/`.

> PWA wymaga HTTPS — GitHub Pages daje go z automatu. Działa też Netlify/Vercel/Cloudflare Pages (przeciągnij folder i gotowe).

## Instalacja na telefonie (Android)
1. Otwórz adres w Chrome na telefonie.
2. Menu (⋮) → **„Dodaj do ekranu głównego"** / „Zainstaluj aplikację".
3. PlantApp pojawia się jak zwykła apka — pełny ekran, własna ikona, działa offline.

## Klucz API Pl@ntNet (darmowy)
1. Konto na [my.plantnet.org](https://my.plantnet.org) → skopiuj swój klucz API.
2. W aplikacji: **Więcej → Klucz API Pl@ntNet → wklej → Zapisz.**
3. Limit darmowy: 500 identyfikacji dziennie — na domowy użytek aż nadto.

Klucz zapisuje się tylko w pamięci Twojego telefonu (localStorage) — nigdzie nie jest wysyłany poza zapytaniami do Pl@ntNet.

## Architektura (i co dalej)
- Czysty HTML/CSS/JS, zero buildów i zależności — `index.html` + `app.js` + `care-db.js` + `sw.js`
- Dane: `localStorage`; zdjęcia kompresowane do miniatur, zdjęcie do AI zmniejszane do 1280px przed wysyłką
- **Faza czujników (ESP32 + NPK):** ten frontend jest gotowy na rozbudowę — dane z czujników mogą trafiać do Supabase (już masz projekt), a aplikacja dociągać je per roślina obok danych z aparatu. Schemat z Twojego Notion (Plan, faza 3) pasuje 1:1.

## Pl@ntNet — uczciwa uwaga
Rozpoznawanie chorób w Pl@ntNet obejmuje ograniczoną listę gatunków i patologii (głównie rośliny uprawne) — dlatego w aplikacji jest też tryb „Po objawach", który działa zawsze i offline. Identyfikacja gatunków działa świetnie dla zdecydowanej większości roślin.
