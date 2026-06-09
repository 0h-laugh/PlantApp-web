# 🌿 PlantApp v2.0 — prod, multi-device

PWA do zarządzania domowym ogrodem: identyfikacja roślin i chorób ze zdjęcia (Pl@ntNet AI),
plan podlewania i nawożenia, dziennik z ewolucją w czasie, konto + synchronizacja między urządzeniami (Supabase).

## Architektura
- **Frontend:** czysty HTML/CSS/JS, PWA (offline poza AI/sync), hosting: GitHub Pages
- **AI:** Pl@ntNet API (darmowe 500 zapytań/dzień, licznik na żywo w apce)
- **Backend:** Supabase free — auth (e-mail+hasło) + tabela `plants` (jsonb) z RLS per użytkownik
- **Sync:** offline-first; localStorage to źródło prawdy na urządzeniu, scalanie per-roślina po `updated_at`
  (last-write-wins), usunięcia przez tombstones; push z debounce 4 s, pull przy starcie/powrocie do apki/online

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
· licznik limitu AI na żywo · konto i sync multi-device · eksport/import JSON
