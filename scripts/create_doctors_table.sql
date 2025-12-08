-- create_doctors_table.sql
-- Run this script inside the Supabase SQL editor (project cjysjpbgdisenofeccgu)
-- to provision the canonical `public.doctors` table used by AIQuestionnairesPage.

create extension if not exists pgcrypto with schema public;

create table if not exists public.doctors (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  name text null,
  age integer null,
  email text null,
  license_number text null,
  specialty text null,
  bio text null,
  designation text null,
  phone text null,
  hospital text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doctors_pkey primary key (id),
  constraint doctors_user_id_key unique (user_id),
  constraint doctors_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete cascade
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_doctors_updated_at on public.doctors;
create trigger trg_doctors_updated_at
before update on public.doctors
for each row
execute function public.set_updated_at();

alter table public.doctors enable row level security;

-- Allow doctors to read/update their own record; admins/full access can be granted separately.
drop policy if exists "Doctors can view own record" on public.doctors;
create policy "Doctors can view own record" on public.doctors
  for select
  using (auth.uid() = user_id);

drop policy if exists "Doctors can update own record" on public.doctors;
create policy "Doctors can update own record" on public.doctors
  for update
  using (auth.uid() = user_id);

-- Allow self-service inserts (signup) by the authenticated user
drop policy if exists "Doctors can insert own record" on public.doctors;
create policy "Doctors can insert own record" on public.doctors
  for insert
  with check (auth.uid() = user_id);

-- Index for faster lookup by user_id
create index if not exists idx_doctors_user_id on public.doctors using btree (user_id);

-- Allow authenticated users (patients) to list doctors for discovery
drop policy if exists "Authenticated users can view doctors" on public.doctors;
create policy "Authenticated users can view doctors" on public.doctors
  for select
  using (auth.role() = 'authenticated');
