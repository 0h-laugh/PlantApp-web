-- PlantApp — pełny schemat + RLS (idempotentny, zgodny ze stanem produkcyjnym).
-- Wklej do Supabase Dashboard → SQL Editor → Run, albo uruchom setup-supabase.mjs.
--
-- Zasady projektowe (ważne przy modyfikacjach):
--  * Funkcje pomocnicze RLS żyją w schemacie `private`, więc NIE są wystawione jako
--    /rest/v1/rpc (mniejsza powierzchnia ataku). Polityki wołają private.is_home_member / private.has_pending_invite.
--  * Każda polityka woła auth.* przez `(select auth.uid())` / `(select auth.jwt())`, żeby
--    Postgres policzył je raz na zapytanie, a nie raz na wiersz (initplan).
--  * SELECT na homes/home_members zawiera bezpośredni warunek na właściciela/siebie, inaczej
--    upsert (INSERT ... ON CONFLICT) świeżego wiersza wywala RLS 403 (funkcja security definer
--    nie widzi jeszcze niezatwierdzonego wiersza).

create extension if not exists pgcrypto;

-- ============================================================================
-- TABELE
-- ============================================================================
create table if not exists public.homes (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.home_members (
  home_id text not null references public.homes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (home_id, user_id)
);

create table if not exists public.home_invites (
  id uuid primary key default gen_random_uuid(),
  home_id text not null references public.homes(id) on delete cascade,
  email text not null,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.rooms (
  id text primary key,
  home_id text not null references public.homes(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plants (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  home_id text references public.homes(id) on delete set null,
  room_id text references public.rooms(id) on delete set null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.plants add column if not exists home_id text references public.homes(id) on delete set null;
alter table public.plants add column if not exists room_id text references public.rooms(id) on delete set null;

create table if not exists public.plant_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  plant_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  context jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace view public.places with (security_invoker = true) as select * from public.homes;

-- ============================================================================
-- FUNKCJE POMOCNICZE RLS (schemat private — poza API REST)
-- ============================================================================
create schema if not exists private;
grant usage on schema private to anon, authenticated;

create or replace function private.is_home_member(home_id_arg text, user_id_arg uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.homes h
    where h.id = home_id_arg and (
      h.owner_id = user_id_arg
      or exists (select 1 from public.home_members hm where hm.home_id = home_id_arg and hm.user_id = user_id_arg)
    )
  );
$$;
revoke all on function private.is_home_member(text, uuid) from public;
grant execute on function private.is_home_member(text, uuid) to anon, authenticated;

create or replace function private.has_pending_invite(home_id_arg text, email_arg text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.home_invites hi
    where hi.home_id = home_id_arg and lower(hi.email) = lower(email_arg)
      and hi.status = 'pending' and hi.expires_at > now()
  );
$$;
revoke all on function private.has_pending_invite(text, text) from public;
grant execute on function private.has_pending_invite(text, text) to anon, authenticated;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.homes enable row level security;
alter table public.home_members enable row level security;
alter table public.home_invites enable row level security;
alter table public.rooms enable row level security;
alter table public.plants enable row level security;
alter table public.plant_assistant_messages enable row level security;
alter table public.user_settings enable row level security;

-- ---- homes (członek lub właściciel widzi; zaproszony widzi nazwę przed akceptacją) ----
drop policy if exists "homes_select_member" on public.homes;
create policy "homes_select_member" on public.homes for select using (
  owner_id = (select auth.uid())
  or private.is_home_member(id, (select auth.uid()))
  or private.has_pending_invite(id, (select auth.jwt()) ->> 'email')
);
drop policy if exists "homes_insert_owner" on public.homes;
create policy "homes_insert_owner" on public.homes for insert with check (owner_id = (select auth.uid()));
drop policy if exists "homes_update_owner" on public.homes;
create policy "homes_update_owner" on public.homes for update using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "homes_delete_owner" on public.homes;
create policy "homes_delete_owner" on public.homes for delete using (owner_id = (select auth.uid()));

-- ---- home_members (widzisz swój wiersz + całe członkostwo domu; właściciel zarządza, użytkownik zarządza sobą) ----
drop policy if exists "home_members_select_member" on public.home_members;
create policy "home_members_select_member" on public.home_members for select using (
  user_id = (select auth.uid()) or private.is_home_member(home_id, (select auth.uid()))
);
drop policy if exists "home_members_insert_owner" on public.home_members;
create policy "home_members_insert_owner" on public.home_members for insert with check (
  exists (select 1 from public.homes h where h.id = home_id and h.owner_id = (select auth.uid()))
  or (user_id = (select auth.uid()) and private.has_pending_invite(home_id, (select auth.jwt()) ->> 'email'))
);
drop policy if exists "home_members_update_owner" on public.home_members;
drop policy if exists "home_members_update_self" on public.home_members;
drop policy if exists "home_members_update" on public.home_members;
create policy "home_members_update" on public.home_members for update using (
  user_id = (select auth.uid())
  or exists (select 1 from public.homes h where h.id = home_id and h.owner_id = (select auth.uid()))
) with check (
  user_id = (select auth.uid())
  or exists (select 1 from public.homes h where h.id = home_id and h.owner_id = (select auth.uid()))
);
drop policy if exists "home_members_delete_owner" on public.home_members;
drop policy if exists "home_members_delete_self" on public.home_members;
drop policy if exists "home_members_delete" on public.home_members;
create policy "home_members_delete" on public.home_members for delete using (
  user_id = (select auth.uid())
  or exists (select 1 from public.homes h where h.id = home_id and h.owner_id = (select auth.uid()))
);

-- ---- rooms (członek domu) ----
drop policy if exists "rooms_select_member" on public.rooms;
create policy "rooms_select_member" on public.rooms for select using (private.is_home_member(home_id, (select auth.uid())));
drop policy if exists "rooms_insert_member" on public.rooms;
create policy "rooms_insert_member" on public.rooms for insert with check (private.is_home_member(home_id, (select auth.uid())));
drop policy if exists "rooms_update_member" on public.rooms;
create policy "rooms_update_member" on public.rooms for update using (private.is_home_member(home_id, (select auth.uid()))) with check (private.is_home_member(home_id, (select auth.uid())));
drop policy if exists "rooms_delete_member" on public.rooms;
create policy "rooms_delete_member" on public.rooms for delete using (private.is_home_member(home_id, (select auth.uid())));

-- ---- home_invites (członek domu lub adresat zaproszenia) ----
drop policy if exists "home_invites_select_member_or_email" on public.home_invites;
create policy "home_invites_select_member_or_email" on public.home_invites for select using (
  private.is_home_member(home_id, (select auth.uid())) or lower(email) = lower((select auth.jwt()) ->> 'email')
);
drop policy if exists "home_invites_insert_member" on public.home_invites;
create policy "home_invites_insert_member" on public.home_invites for insert with check (
  private.is_home_member(home_id, (select auth.uid())) and invited_by = (select auth.uid())
);
drop policy if exists "home_invites_update_member_or_invited" on public.home_invites;
create policy "home_invites_update_member_or_invited" on public.home_invites for update using (
  private.is_home_member(home_id, (select auth.uid())) or lower(email) = lower((select auth.jwt()) ->> 'email')
) with check (
  private.is_home_member(home_id, (select auth.uid())) or lower(email) = lower((select auth.jwt()) ->> 'email')
);
drop policy if exists "home_invites_delete_member" on public.home_invites;
create policy "home_invites_delete_member" on public.home_invites for delete using (private.is_home_member(home_id, (select auth.uid())));

-- ---- plants (właściciel rośliny lub współdomownik) ----
drop policy if exists "plants_select_own" on public.plants;
drop policy if exists "plants_insert_own" on public.plants;
drop policy if exists "plants_update_own" on public.plants;
drop policy if exists "plants_delete_own" on public.plants;
drop policy if exists "plants_select_home_member" on public.plants;
create policy "plants_select_home_member" on public.plants for select using (
  (select auth.uid()) = user_id or (home_id is not null and private.is_home_member(home_id, (select auth.uid())))
);
drop policy if exists "plants_insert_home_member" on public.plants;
create policy "plants_insert_home_member" on public.plants for insert with check (
  (select auth.uid()) = user_id and (home_id is null or private.is_home_member(home_id, (select auth.uid())))
);
drop policy if exists "plants_update_home_member" on public.plants;
create policy "plants_update_home_member" on public.plants for update using (
  (select auth.uid()) = user_id or (home_id is not null and private.is_home_member(home_id, (select auth.uid())))
) with check (
  (select auth.uid()) = user_id or (home_id is not null and private.is_home_member(home_id, (select auth.uid())))
);
drop policy if exists "plants_delete_home_member" on public.plants;
create policy "plants_delete_home_member" on public.plants for delete using (
  (select auth.uid()) = user_id or (home_id is not null and private.is_home_member(home_id, (select auth.uid())))
);

-- ---- plant_assistant_messages (właściciel) ----
drop policy if exists "assistant_select_own" on public.plant_assistant_messages;
create policy "assistant_select_own" on public.plant_assistant_messages for select using ((select auth.uid()) = user_id);
drop policy if exists "assistant_insert_own" on public.plant_assistant_messages;
create policy "assistant_insert_own" on public.plant_assistant_messages for insert with check ((select auth.uid()) = user_id);
drop policy if exists "assistant_delete_own" on public.plant_assistant_messages;
create policy "assistant_delete_own" on public.plant_assistant_messages for delete using ((select auth.uid()) = user_id);

-- ---- user_settings (właściciel: klucz Pl@ntNet + konfiguracja asystenta) ----
drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings for select using ((select auth.uid()) = user_id);
drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own" on public.user_settings for insert with check ((select auth.uid()) = user_id);
drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "user_settings_delete_own" on public.user_settings;
create policy "user_settings_delete_own" on public.user_settings for delete using ((select auth.uid()) = user_id);

-- ============================================================================
-- INDEKSY (w tym pokrywające klucze obce — wymóg lintera wydajności)
-- ============================================================================
create index if not exists homes_owner_idx on public.homes(owner_id);
create index if not exists home_members_user_idx on public.home_members(user_id);
create index if not exists home_members_home_idx on public.home_members(home_id);
create index if not exists home_invites_home_status_idx on public.home_invites(home_id, status);
create index if not exists home_invites_email_status_idx on public.home_invites(lower(email), status);
create index if not exists home_invites_invited_by_idx on public.home_invites(invited_by);
create index if not exists rooms_home_idx on public.rooms(home_id);
create index if not exists plants_user_idx on public.plants(user_id);
create index if not exists plants_home_idx on public.plants(home_id);
create index if not exists plants_room_idx on public.plants(room_id);
create index if not exists assistant_plant_user_idx on public.plant_assistant_messages(plant_id, user_id, created_at);
create index if not exists assistant_user_idx on public.plant_assistant_messages(user_id);

-- ============================================================================
-- KONFIGURACJA RĘCZNA (poza SQL):
--  * Authentication → Providers → Email → włącz „Leaked password protection"
--    (Supabase sprawdza hasła w HaveIBeenPwned). Linter bezpieczeństwa to zaleca.
-- ============================================================================
