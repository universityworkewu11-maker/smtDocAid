-- create_patients_policies.sql
-- Adds Row Level Security policies to allow patients to manage their own `public.patients` row.
-- Run this in the Supabase SQL editor for your project.

alter table if exists public.patients enable row level security;

-- Allow authenticated users to read patient rows (useful for patient portal)
create policy "Authenticated read patients" on public.patients
  for select
  using (auth.role() = 'authenticated');

-- Allow a user to insert their own patient row (user_id must match)
create policy "Patients can insert own record" on public.patients
  for insert
  with check (auth.uid() = user_id);

-- Allow a user to update their own patient row
create policy "Patients can update own record" on public.patients
  for update
  using (auth.uid() = user_id);

-- Allow a user to delete their own patient row (optional)
create policy "Patients can delete own record" on public.patients
  for delete
  using (auth.uid() = user_id);

-- Note: If your app needs public (unauthenticated) read access to patients,
-- consider creating a select policy with `using (true)` but be mindful of PHI/privacy.
