# 🌿 PlantApp v2.0 — prod, multi-device

PWA do zarządzania domowym ogrodem: identyfikacja roślin i chorób ze zdjęcia (Pl@ntNet AI),
plan podlewania i nawożenia, dziennik z ewolucją w czasie, konto + synchronizacja między urządzeniami (Supabase).

## Architektura
- **Frontend:** czysty HTML/CSS/JS, PWA (offline poza AI/sync), hosting: GitHub Pages
- **AI:** Pl@ntNet API (darmowe 500 zapytań/dzień, licznik na żywo w apce)
- **Backend:** Supabase free — auth (e-mail+hasło), domy/pokoje, zaproszenia domowników, ustawienia użytkownika i RLS per dom/użytkownik.
- **Sync:** offline-first; localStorage działa jako cache i bufor zmian, a Supabase scala dane między urządzeniami.
  Synchronizacja łączy dzienniki po identyfikatorach wpisów, zachowuje tombstones usuniętych roślin oraz wspiera pola `home_id`/`room_id`.

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

## Free plan — ważne
Supabase free pauzuje projekt po **7 dniach bez ruchu**. Apka przy każdym otwarciu z zalogowanym
kontem robi pull — normalne używanie utrzymuje projekt przy życiu. Po dłuższym urlopie:
Dashboard → Restore (działa do 90 dni pauzy).

## Funkcje
Skanuj (gatunek ze zdjęcia) · Doktor (choroba ze zdjęcia AI / objawy offline, zapis do dziennika konkretnej rośliny)
· pierścień podlewania lato/zima · nawożenie co 30 dni w sezonie · dziennik + ewolucja zdjęciowa
· licznik limitu AI na żywo · konto i sync multi-device · pokoje i udostępnianie domu · notatki i lightbox zdjęć


## Model danych Supabase
- `homes`, `rooms`, `home_members`, `home_invites` — domy, pokoje i współdzielenie przez zaproszenia.
- `plants` — bieżący snapshot rośliny z `home_id`, `room_id`, `data jsonb` i tombstones dla usunięć.
- `plant_journal_entries`, `plant_photos` — przygotowane tabele znormalizowane dla konfliktów dziennika i zdjęć; klient zachowuje kompatybilny snapshot JSON.
- `user_settings` — ustawienia per użytkownik, w tym klucz Pl@ntNet; opcjonalny `PLANTNET_EDGE_FUNCTION_URL` może przenieść wywołania API za Edge Function.
