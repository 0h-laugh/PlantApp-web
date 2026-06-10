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
create extension if not exists pgcrypto;

create table if not exists public.homes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Mój dom',
  address text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.homes enable row level security;

create table if not exists public.home_members (
  home_id uuid not null references public.homes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (home_id, user_id)
);
alter table public.home_members enable row level security;

create table if not exists public.home_invites (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  email text not null,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.home_invites enable row level security;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rooms enable row level security;

create table if not exists public.plants (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  home_id uuid references public.homes(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.plants add column if not exists home_id uuid references public.homes(id) on delete cascade;
alter table public.plants add column if not exists room_id uuid references public.rooms(id) on delete set null;
alter table public.plants enable row level security;

create or replace function public.can_access_home(target_home_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.homes h
    where h.id = target_home_id and h.user_id = auth.uid()
  ) or exists (
    select 1 from public.home_members hm
    where hm.home_id = target_home_id and hm.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_home(target_home_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.homes h
    where h.id = target_home_id and h.user_id = auth.uid()
  ) or exists (
    select 1 from public.home_members hm
    where hm.home_id = target_home_id and hm.user_id = auth.uid() and hm.role in ('owner', 'editor')
  );
$$;

create or replace function public.has_pending_invite(target_home_id uuid, target_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.home_invites hi
    where hi.home_id = target_home_id
      and lower(hi.email) = lower(target_email)
      and hi.status = 'pending'
      and hi.expires_at > now()
  );
$$;

drop policy if exists "homes_select_access" on public.homes;
create policy "homes_select_access" on public.homes for select using (public.can_access_home(id));
drop policy if exists "homes_insert_own" on public.homes;
create policy "homes_insert_own" on public.homes for insert with check (auth.uid() = user_id);
drop policy if exists "homes_update_editors" on public.homes;
create policy "homes_update_editors" on public.homes for update using (public.can_edit_home(id)) with check (public.can_edit_home(id));
drop policy if exists "homes_delete_owner" on public.homes;
create policy "homes_delete_owner" on public.homes for delete using (auth.uid() = user_id);

drop policy if exists "home_members_select_access" on public.home_members;
create policy "home_members_select_access" on public.home_members for select using (user_id = auth.uid() or public.can_access_home(home_id));
drop policy if exists "home_members_insert_invited_or_editor" on public.home_members;
create policy "home_members_insert_invited_or_editor" on public.home_members for insert with check (
  public.can_edit_home(home_id)
  or (user_id = auth.uid() and public.has_pending_invite(home_id, auth.jwt() ->> 'email'))
);
drop policy if exists "home_members_update_owner" on public.home_members;
create policy "home_members_update_owner" on public.home_members for update using (public.can_edit_home(home_id)) with check (public.can_edit_home(home_id));
drop policy if exists "home_members_delete_owner_or_self" on public.home_members;
create policy "home_members_delete_owner_or_self" on public.home_members for delete using (user_id = auth.uid() or public.can_edit_home(home_id));

drop policy if exists "home_invites_select_access_or_email" on public.home_invites;
create policy "home_invites_select_access_or_email" on public.home_invites for select using (
  public.can_access_home(home_id) or lower(email) = lower(auth.jwt() ->> 'email')
);
drop policy if exists "home_invites_insert_editor" on public.home_invites;
create policy "home_invites_insert_editor" on public.home_invites for insert with check (public.can_edit_home(home_id) and invited_by = auth.uid());
drop policy if exists "home_invites_update_editor_or_invited" on public.home_invites;
create policy "home_invites_update_editor_or_invited" on public.home_invites for update using (
  public.can_edit_home(home_id) or lower(email) = lower(auth.jwt() ->> 'email')
) with check (
  public.can_edit_home(home_id) or lower(email) = lower(auth.jwt() ->> 'email')
);
drop policy if exists "home_invites_delete_editor" on public.home_invites;
create policy "home_invites_delete_editor" on public.home_invites for delete using (public.can_edit_home(home_id));

drop policy if exists "rooms_select_home_access" on public.rooms;
create policy "rooms_select_home_access" on public.rooms for select using (public.can_access_home(home_id));
drop policy if exists "rooms_insert_home_editor" on public.rooms;
create policy "rooms_insert_home_editor" on public.rooms for insert with check (public.can_edit_home(home_id));
drop policy if exists "rooms_update_home_editor" on public.rooms;
create policy "rooms_update_home_editor" on public.rooms for update using (public.can_edit_home(home_id)) with check (public.can_edit_home(home_id));
drop policy if exists "rooms_delete_home_editor" on public.rooms;
create policy "rooms_delete_home_editor" on public.rooms for delete using (public.can_edit_home(home_id));

drop policy if exists "plants_select_own" on public.plants;
drop policy if exists "plants_insert_own" on public.plants;
drop policy if exists "plants_update_own" on public.plants;
drop policy if exists "plants_delete_own" on public.plants;
drop policy if exists "plants_select_home_access" on public.plants;
create policy "plants_select_home_access" on public.plants for select using (auth.uid() = user_id or public.can_access_home(home_id));
drop policy if exists "plants_insert_home_access" on public.plants;
create policy "plants_insert_home_access" on public.plants for insert with check (auth.uid() = user_id and (home_id is null or public.can_edit_home(home_id)));
drop policy if exists "plants_update_home_access" on public.plants;
create policy "plants_update_home_access" on public.plants for update using (auth.uid() = user_id or public.can_edit_home(home_id)) with check (auth.uid() = user_id or public.can_edit_home(home_id));
drop policy if exists "plants_delete_home_access" on public.plants;
create policy "plants_delete_home_access" on public.plants for delete using (auth.uid() = user_id or public.can_edit_home(home_id));

create index if not exists homes_user_idx on public.homes(user_id);
create index if not exists home_members_user_idx on public.home_members(user_id);
create index if not exists home_members_home_idx on public.home_members(home_id);
create index if not exists home_invites_home_status_idx on public.home_invites(home_id, status);
create index if not exists home_invites_email_status_idx on public.home_invites(lower(email), status);
create index if not exists rooms_home_idx on public.rooms(home_id);
create index if not exists plants_user_idx on public.plants(user_id);
create index if not exists plants_home_idx on public.plants(home_id);
create index if not exists plants_room_idx on public.plants(room_id);
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
  console.log("  ✓ Tabela public.plants z politykami RLS");

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
