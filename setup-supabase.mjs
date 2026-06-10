#!/usr/bin/env node
/* PlantApp — provisioning Supabase (free plan) jedną komendą.
   Użycie:  SUPABASE_ACCESS_TOKEN=sbp_xxx node setup-supabase.mjs
   Tworzy projekt, schemat z RLS, włącza auto-potwierdzanie e-maili
   i zapisuje config.js dla aplikacji. Idempotentny — można odpalać ponownie. */

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const API = "https://api.supabase.com";
const PROJECT_NAME = "plantapp-prod";
const REGION = "eu-central-1"; // Frankfurt — najbliżej PL

if (!TOKEN || !TOKEN.startsWith("sbp_")) {
  console.error("Ustaw token:  SUPABASE_ACCESS_TOKEN=sbp_xxx node setup-supabase.mjs");
  process.exit(1);
}

const SQL = `
create table if not exists public.plants (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  name text,
  latin text,
  added timestamptz,
  last_watered timestamptz,
  last_fertilized timestamptz,
  custom_interval integer,
  field_clock jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.plants add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.plants add column if not exists name text;
alter table public.plants add column if not exists latin text;
alter table public.plants add column if not exists added timestamptz;
alter table public.plants add column if not exists last_watered timestamptz;
alter table public.plants add column if not exists last_fertilized timestamptz;
alter table public.plants add column if not exists custom_interval integer;
alter table public.plants add column if not exists field_clock jsonb not null default '{}'::jsonb;
alter table public.plants add column if not exists deleted_at timestamptz;
alter table public.plants add column if not exists updated_at timestamptz not null default now();

create table if not exists public.plant_journal_entries (
  id text primary key,
  plant_id text not null references public.plants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  entry_time timestamptz not null,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.plant_photos (
  id text primary key,
  plant_id text not null references public.plants(id) on delete cascade,
  journal_entry_id text references public.plant_journal_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('cover', 'journal')),
  photo text not null,
  updated_at timestamptz not null default now()
);

alter table public.plants enable row level security;
alter table public.plant_journal_entries enable row level security;
alter table public.plant_photos enable row level security;

drop policy if exists "plants_select_own" on public.plants;
create policy "plants_select_own" on public.plants for select using (auth.uid() = user_id);
drop policy if exists "plants_insert_own" on public.plants;
create policy "plants_insert_own" on public.plants for insert with check (auth.uid() = user_id);
drop policy if exists "plants_update_own" on public.plants;
create policy "plants_update_own" on public.plants for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "plants_delete_own" on public.plants;
create policy "plants_delete_own" on public.plants for delete using (auth.uid() = user_id);

drop policy if exists "plant_journal_entries_select_own" on public.plant_journal_entries;
create policy "plant_journal_entries_select_own" on public.plant_journal_entries for select using (auth.uid() = user_id);
drop policy if exists "plant_journal_entries_insert_own" on public.plant_journal_entries;
create policy "plant_journal_entries_insert_own" on public.plant_journal_entries for insert with check (auth.uid() = user_id);
drop policy if exists "plant_journal_entries_update_own" on public.plant_journal_entries;
create policy "plant_journal_entries_update_own" on public.plant_journal_entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "plant_journal_entries_delete_own" on public.plant_journal_entries;
create policy "plant_journal_entries_delete_own" on public.plant_journal_entries for delete using (auth.uid() = user_id);

drop policy if exists "plant_photos_select_own" on public.plant_photos;
create policy "plant_photos_select_own" on public.plant_photos for select using (auth.uid() = user_id);
drop policy if exists "plant_photos_insert_own" on public.plant_photos;
create policy "plant_photos_insert_own" on public.plant_photos for insert with check (auth.uid() = user_id);
drop policy if exists "plant_photos_update_own" on public.plant_photos;
create policy "plant_photos_update_own" on public.plant_photos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "plant_photos_delete_own" on public.plant_photos;
create policy "plant_photos_delete_own" on public.plant_photos for delete using (auth.uid() = user_id);

create index if not exists plants_user_idx on public.plants(user_id);
create index if not exists plant_journal_entries_user_plant_idx on public.plant_journal_entries(user_id, plant_id);
create index if not exists plant_photos_user_plant_idx on public.plant_photos(user_id, plant_id);
`;

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} → ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const genPass = () => "Pa_" + [...crypto.getRandomValues(new Uint8Array(18))].map(b => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"[b % 55]).join("");

(async () => {
  console.log("→ Szukam organizacji…");
  const orgs = await api("/v1/organizations");
  if (!orgs.length) throw new Error("Brak organizacji na koncie Supabase.");
  const org = orgs[0];
  console.log(`  ✓ ${org.name} (${org.id})`);

  console.log("→ Sprawdzam, czy projekt już istnieje…");
  const projects = await api("/v1/projects");
  let project = projects.find(p => p.name === PROJECT_NAME);

  if (project) {
    console.log(`  ✓ Istnieje: ${project.id} (status: ${project.status})`);
  } else {
    console.log(`→ Tworzę projekt "${PROJECT_NAME}" w ${REGION}…`);
    const dbPass = genPass();
    project = await api("/v1/projects", {
      method: "POST",
      body: JSON.stringify({ organization_id: org.id, name: PROJECT_NAME, region: REGION, db_pass: dbPass }),
    });
    console.log(`  ✓ Utworzony: ${project.id}`);
    console.log(`  🔑 Hasło DB (zapisz w menedżerze haseł, NIE w Notion plaintextem): ${dbPass}`);
  }
  const ref = project.id;

  console.log("→ Czekam aż projekt będzie ACTIVE_HEALTHY (do ~2 min)…");
  for (let i = 0; i < 40; i++) {
    const p = await api(`/v1/projects/${ref}`);
    if (p.status === "ACTIVE_HEALTHY") { console.log("  ✓ Działa"); break; }
    if (i === 39) throw new Error("Projekt nie wstał w czasie — sprawdź dashboard i odpal skrypt ponownie.");
    await sleep(5000);
    process.stdout.write(".");
  }

  console.log("→ Zakładam schemat + RLS…");
  await api(`/v1/projects/${ref}/database/query`, { method: "POST", body: JSON.stringify({ query: SQL }) });
  console.log("  ✓ Tabele public.plants / plant_journal_entries / plant_photos z politykami RLS");

  console.log("→ Włączam auto-potwierdzanie e-maili (bez klikania w linki)…");
  await api(`/v1/projects/${ref}/config/auth`, { method: "PATCH", body: JSON.stringify({ mailer_autoconfirm: true }) });
  console.log("  ✓ Rejestracja działa od razu");

  console.log("→ Pobieram klucz anon…");
  const keys = await api(`/v1/projects/${ref}/api-keys`);
  const anon = (keys.find(k => k.name === "anon") || {}).api_key;
  if (!anon) throw new Error("Nie znalazłem klucza anon — sprawdź dashboard → Settings → API.");

  const url = `https://${ref}.supabase.co`;
  const config = `// PlantApp — wygenerowano przez setup-supabase.mjs ${new Date().toISOString()}
window.PA_CONFIG = {
  SUPABASE_URL: "${url}",
  SUPABASE_ANON_KEY: "${anon}"
};
`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync("config.js", config);

  console.log("\n══════════════════════════════════════════");
  console.log("GOTOWE ✓");
  console.log("  Projekt:  " + url);
  console.log("  config.js zapisany — commit + push i apka ma backend.");
  console.log("  Klucz anon jest PUBLICZNY z założenia (RLS pilnuje danych) — można commitować.");
  console.log("══════════════════════════════════════════");
})().catch(e => { console.error("\n✗ " + e.message); process.exit(1); });
