-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Sets up code-gated shared workspaces (no user accounts -- a project is looked
-- up by its code, matching how this app is designed to work).

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  state jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table projects enable row level security;

-- No real auth in this app -- anyone with a project's code can read/write it,
-- enforced at the app layer, not by Postgres. Intentionally permissive here.
-- Postgres has no `create policy if not exists`, so drop-then-create makes
-- this file safe to run again in full (e.g. after adding a policy below).
drop policy if exists "anyone can read projects" on projects;
create policy "anyone can read projects" on projects for select using (true);
drop policy if exists "anyone can write projects" on projects;
create policy "anyone can write projects" on projects for insert with check (true);
drop policy if exists "anyone can update projects" on projects;
create policy "anyone can update projects" on projects for update using (true);

insert into storage.buckets (id, name, public)
values ('tile-assets', 'tile-assets', false)
on conflict (id) do nothing;

drop policy if exists "anyone can read tile assets" on storage.objects;
create policy "anyone can read tile assets" on storage.objects for select
  using (bucket_id = 'tile-assets');
drop policy if exists "anyone can upload tile assets" on storage.objects;
create policy "anyone can upload tile assets" on storage.objects for insert
  with check (bucket_id = 'tile-assets');
-- re-saving a project re-uploads its assets with upsert, which Storage does
-- as an update on an existing object -- needs its own policy, separate from insert.
drop policy if exists "anyone can overwrite tile assets" on storage.objects;
create policy "anyone can overwrite tile assets" on storage.objects for update
  using (bucket_id = 'tile-assets');
drop policy if exists "anyone can delete tile assets" on storage.objects;
create policy "anyone can delete tile assets" on storage.objects for delete
  using (bucket_id = 'tile-assets');
