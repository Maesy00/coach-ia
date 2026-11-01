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
