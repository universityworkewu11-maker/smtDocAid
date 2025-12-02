-- create_documents_table.sql
-- Run within Supabase SQL editor to provision metadata for uploaded files.

create extension if not exists pgcrypto with schema public;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_bucket text not null default 'uploads',
  storage_path text not null,
  file_name text not null,
  original_name text,
  mime_type text,
  size_bytes bigint,
  public_url text,
  checksum text,
  metadata jsonb default '{}'::jsonb,
    extraction_status text not null default 'pending',
    extracted_text text,
    extraction_summary text,
    extraction_error text,
    last_extracted_at timestamptz,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_user_id_idx on public.documents(user_id);
create index if not exists documents_uploaded_at_idx on public.documents(uploaded_at desc);

create or replace function public.set_documents_updated_at()
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

drop trigger if exists trg_documents_updated_at on public.documents;
create trigger trg_documents_updated_at
before update on public.documents
for each row
execute function public.set_documents_updated_at();

alter table public.documents enable row level security;

create policy "documents_select_own" on public.documents
  for select
  using (auth.uid() = user_id);

create policy "documents_insert_own" on public.documents
  for insert
  with check (auth.uid() = user_id);

create policy "documents_update_own" on public.documents
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "documents_delete_own" on public.documents
  for delete
  using (auth.uid() = user_id);
