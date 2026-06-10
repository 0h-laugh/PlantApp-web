# 🌿 PlantApp v2.0 — prod, multi-device

PWA do zarządzania domowym ogrodem: identyfikacja roślin i chorób ze zdjęcia (Pl@ntNet AI),
plan podlewania i nawożenia, dziennik z ewolucją w czasie, konto + synchronizacja między urządzeniami (Supabase).

## Architektura
- **Frontend:** czysty HTML/CSS/JS, PWA (offline poza AI/sync), hosting: GitHub Pages
- **Motyw:** tokeny CSS + przełącznik ciemny/jasny („Nocna oranżeria" / „Jasna szklarnia"), zapis w `localStorage`
- **Rozpoznawanie:** Pl@ntNet API (darmowe 500 zapytań/dzień, licznik na żywo). `organs` jest polem
  multipart (jedno na zdjęcie); pominięcie = `auto`. NIE wysyłaj `organs` w query stringu (PlantNet zwraca 400).
- **Asystent AI:** konfigurowalny w apce dostawca zgodny z OpenAI (OpenRouter free / Groq / własny adres),
  klucz w `user_settings`, wołany wprost z przeglądarki; domyślny model OpenRouter `openai/gpt-oss-120b:free`,
  retry przy 429. Opcjonalny fallback: Edge Function `plant-assistant` (Anthropic, niewdrożona domyślnie).
- **Backend:** Supabase — auth (e-mail+hasło) + tabele `homes`/`rooms`/`plants`/`home_members`/`home_invites`/
  `user_settings`/`plant_assistant_messages`. RLS: funkcje pomocnicze w schemacie `private` (poza REST),
  polityki wołają `auth.*` przez `(select …)` (eval raz na zapytanie). Szczegóły: `supabase/schema.sql`.
- **Współdzielenie:** zaproszenia do domu (`home_invites` + token); po akceptacji domownik widzi dom,
  pokoje i rośliny. Akceptacja używa zwykłego INSERT do `home_members` (nie upsert — upsert wymaga
  polityki UPDATE, która jest owner-only, stąd dawne 403).
- **Sync:** po zalogowaniu Supabase jest źródłem synchronizacji; localStorage działa jako cache offline
  i bufor zmian bez sieci. Scalanie per-roślina po `updated_at` (last-write-wins) z łączeniem dzienników
  **po treści wpisu** (nie po zmiennym `id` — inaczej te same wpisy mnożyły się przy każdym sync);
  usunięcia przez tombstones; push z debounce 4 s, pull przy starcie/powrocie do apki/online.

## Uruchomienie backendu (raz)
```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx node setup-supabase.mjs
```
Skrypt: tworzy projekt `plantapp-prod` (Frankfurt), zakłada schemat + RLS, włącza auto-potwierdzanie
e-maili i zapisuje `config.js`. Potem:
```bash
git add . && git commit -m "v2.0 prod + supabase" && git push
```
`config.js` zawiera URL projektu i klucz **anon** — jest publiczny z założenia, danych pilnuje RLS.
Token `sbp_` to co innego — NIGDY go nie commituj i zrotuj po setupie (Dashboard → Account → Access Tokens).

### Po wdrożeniu schematu — krok ręczny (raz)
Authentication → Providers → Email → włącz **„Leaked password protection"** (sprawdzanie haseł w
HaveIBeenPwned). To jedyne zalecenie lintera bezpieczeństwa, którego nie da się ustawić z SQL.

## Free plan — ważne
Supabase free pauzuje projekt po **7 dniach bez ruchu**. Apka przy każdym otwarciu z zalogowanym
kontem robi pull — normalne używanie utrzymuje projekt przy życiu. Po dłuższym urlopie:
Dashboard → Restore (działa do 90 dni pauzy).

## Funkcje
Skanuj (gatunek ze zdjęcia) · Doktor (choroba ze zdjęcia AI / objawy offline, zapis do dziennika konkretnej rośliny)
· pierścień podlewania lato/zima · nawożenie co 30 dni w sezonie · dziennik + ewolucja zdjęciowa
· licznik limitu AI na żywo · konto i sync multi-device · status synchronizacji i ręczny przycisk „Synchronizuj teraz”
