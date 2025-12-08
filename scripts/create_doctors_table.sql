-- create_doctors_table.sql
-- Run this script inside the Supabase SQL editor (project cjysjpbgdisenofeccgu)
-- to provision the canonical `public.doctors` table used by AIQuestionnairesPage.

create extension if not exists pgcrypto with schema public;

create table if not exists public.doctors (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  name text,
  age integer,
  email text,
  license_number text,
  specialist text,
  specialty text,
  specialities text[],
  bio text,
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
create policy "Doctors can view own record" on public.doctors
  for select
  using (auth.uid() = user_id);

create policy "Doctors can update own record" on public.doctors
  for update
  using (auth.uid() = user_id);

-- Optional: allow service role (via RLS bypass) or add insert policy if you expect self-service signup.

-- Allow doctors to insert their own record during self-service signup when they are authenticated.
-- This policy requires the client to be authenticated (auth.uid() set) and match the provided user_id.
create policy "Doctors can insert own record" on public.doctors
  for insert
  with check (auth.uid() = user_id);

-- Note: If your sign-up flow requires email confirmation (no session returned after signUp),
-- the client will not be authenticated yet and this policy will prevent inserts. In that case
-- create the `doctors` row either from a server-side function using the service key or create
-- the row after the user has confirmed and signed in (the app's `fetchProfile` already does this).
