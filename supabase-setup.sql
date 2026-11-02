-- Coach.ia — tables Supabase.
-- À exécuter dans l'éditeur SQL du projet Supabase « Aurora » (le même que
-- pour Aurora, Ironly, Pause et Osmosy : même compte de connexion).
-- Tables préfixées "coach_" : aucun risque pour les données des autres apps.
-- Le script peut être relancé sans danger (if not exists partout).
--
-- Archivage (comme dans Pause et Aurora) : rien n'est effacé, « Supprimer »
-- renseigne archived_at et l'élément est simplement masqué.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Étape 1 — Sports
-- Les 6 sports par défaut sont créés par l'app au premier lancement
-- (slug = running, swimming, cycling, strength, yoga, pilates) ;
-- les sports ajoutés à la main ont un slug "custom-…".
-- ---------------------------------------------------------------------------

create table if not exists coach_sports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  icon text not null,
  color text not null,
  has_distance boolean not null default false,
  position integer not null default 0,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);

alter table coach_sports enable row level security;

-- Chacun ne peut lire/écrire que ses propres données (pas de suppression : on archive).
drop policy if exists "coach_sports_select_own" on coach_sports;
drop policy if exists "coach_sports_insert_own" on coach_sports;
drop policy if exists "coach_sports_update_own" on coach_sports;
create policy "coach_sports_select_own" on coach_sports for select using (auth.uid() = user_id);
create policy "coach_sports_insert_own" on coach_sports for insert with check (auth.uid() = user_id);
create policy "coach_sports_update_own" on coach_sports for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Étape 2 — Musculation
-- Exercices personnalisés (en plus du catalogue d'Ironly, dans le code) et
-- programmes. exercises = [{ exerciseId, sets, reps ("8-12"), weight, rest }]
-- (rest en secondes). La séance en cours vit dans le navigateur ; une fois
-- terminée, elle devient une activité (sport "strength", détail dans details).
-- legacy_ref = d'où vient la ligne en cas de migration (ex. "aurora:strength_plans:<id>").
-- ---------------------------------------------------------------------------

create table if not exists coach_custom_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  muscle_group text not null,
  metric text not null check (metric in ('weight_reps', 'bodyweight_reps', 'time')),
  legacy_ref text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, legacy_ref)
);

create table if not exists coach_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  exercises jsonb not null default '[]',
  legacy_ref text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, legacy_ref)
);

-- ---------------------------------------------------------------------------
-- Étape 4 — Historique (toutes les activités, toutes sources confondues)
-- sport = slug de coach_sports. start_time est vide quand l'heure est
-- inconnue (historique Aurora, saisie sans heure).
-- source : manual, strength, garmin, strava, aurora, ironly.
-- ---------------------------------------------------------------------------

create table if not exists coach_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sport text not null,
  date date not null,
  start_time time,
  duration_minutes numeric not null default 0,
  distance_km numeric,
  elevation_m numeric,
  avg_hr smallint,
  max_hr smallint,
  rpe smallint check (rpe between 1 and 10),
  title text,
  notes text not null default '',
  source text not null default 'manual',
  external_id text,
  details jsonb,
  legacy_ref text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, legacy_ref)
);

create index if not exists coach_activities_user_date on coach_activities (user_id, date desc);

-- ---------------------------------------------------------------------------
-- Étape 3 — Semaine : séances prévues et semaines types
-- intensity : ef, tempo, seuil, fractionne, vma, sortie_longue, recup, libre (ou vide).
-- activity_id relie une séance prévue à l'activité réalisée (prévu vs réalisé).
-- sessions d'un modèle = [{ weekday (0 = lundi), startTime, durationMinutes, sport, intensity, notes, programId }]
-- ---------------------------------------------------------------------------

create table if not exists coach_planned (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  start_time time,
  duration_minutes integer not null default 60,
  sport text not null,
  intensity text,
  notes text not null default '',
  program_id uuid references coach_programs(id) on delete set null,
  activity_id uuid references coach_activities(id) on delete set null,
  done_at timestamptz,
  legacy_ref text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, legacy_ref)
);

create index if not exists coach_planned_user_date on coach_planned (user_id, date);

create table if not exists coach_week_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sessions jsonb not null default '[]',
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

-- Règles d'accès : chacun ne lit/écrit que ses propres lignes (pas de suppression : on archive).
do $$
declare t text;
begin
  foreach t in array array['coach_custom_exercises', 'coach_programs', 'coach_activities', 'coach_planned', 'coach_week_templates'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select_own', t);
    execute format('drop policy if exists %I on %I', t || '_insert_own', t);
    execute format('drop policy if exists %I on %I', t || '_update_own', t);
    execute format('create policy %I on %I for select using (auth.uid() = user_id)', t || '_select_own', t);
    execute format('create policy %I on %I for insert with check (auth.uid() = user_id)', t || '_insert_own', t);
    execute format('create policy %I on %I for update using (auth.uid() = user_id)', t || '_update_own', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Étape 3 — Abonnement Apple Calendar (même principe que Pause)
-- Chaque utilisateur a un lien secret (token). Le calendrier de l'iPhone ne
-- peut pas se connecter : c'est ce lien qui donne accès au flux, via la
-- fonction coach-calendar (Edge Function) et coach_calendar_feed ci-dessous.
-- ---------------------------------------------------------------------------

create table if not exists coach_calendar_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now()
);

alter table coach_calendar_tokens enable row level security;

drop policy if exists "coach_calendar_tokens_select_own" on coach_calendar_tokens;
drop policy if exists "coach_calendar_tokens_insert_own" on coach_calendar_tokens;
drop policy if exists "coach_calendar_tokens_delete_own" on coach_calendar_tokens;
create policy "coach_calendar_tokens_select_own" on coach_calendar_tokens for select using (auth.uid() = user_id);
create policy "coach_calendar_tokens_insert_own" on coach_calendar_tokens for insert with check (auth.uid() = user_id);
create policy "coach_calendar_tokens_delete_own" on coach_calendar_tokens for delete using (auth.uid() = user_id);

-- Séances prévues (60 derniers jours et à venir) pour un lien donné.
-- "security definer" : lit les tables sans connexion, mais seulement pour le
-- titulaire du lien, et seulement ses séances prévues.
create or replace function coach_calendar_feed(feed_token text)
returns table (id uuid, date date, start_time time, duration_minutes integer, sport_name text,
               intensity text, notes text, program_name text, done boolean)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.date, p.start_time, p.duration_minutes, coalesce(s.name, p.sport),
         p.intensity, p.notes, pr.name, (p.done_at is not null or p.activity_id is not null)
  from coach_planned p
  join coach_calendar_tokens t on t.user_id = p.user_id
  left join coach_sports s on s.user_id = p.user_id and s.slug = p.sport
  left join coach_programs pr on pr.id = p.program_id
  where t.token = feed_token and p.archived_at is null and p.date >= current_date - 60
$$;

revoke all on function coach_calendar_feed(text) from public;
grant execute on function coach_calendar_feed(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Réglages personnels : FC de repos et FC max, pour la charge par la
-- fréquence cardiaque (TRIMP). Une ligne par utilisateur.
-- trimp_profile : 'm' (coefficient 1,92) ou 'f' (1,67), formule de Banister.
-- ---------------------------------------------------------------------------

create table if not exists coach_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rest_hr smallint check (rest_hr between 30 and 120),
  max_hr smallint check (max_hr between 120 and 230),
  trimp_profile text not null default 'm' check (trimp_profile in ('m', 'f')),
  updated_at timestamptz not null default now()
);

alter table coach_settings enable row level security;

drop policy if exists "coach_settings_select_own" on coach_settings;
drop policy if exists "coach_settings_insert_own" on coach_settings;
drop policy if exists "coach_settings_update_own" on coach_settings;
create policy "coach_settings_select_own" on coach_settings for select using (auth.uid() = user_id);
create policy "coach_settings_insert_own" on coach_settings for insert with check (auth.uid() = user_id);
create policy "coach_settings_update_own" on coach_settings for update using (auth.uid() = user_id);
