-- Agent Relay reference schema (Supabase / Postgres)
-- Demo-grade RLS: permissive policies so you can get running in minutes.
-- Tighten before production (Supabase Auth for humans, per-key scoping for agents).

-- ── Tables ────────────────────────────────────────────────────────────────

create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  dream_owner text,                       -- member name that owns nightly consolidation
  created_at  timestamptz not null default now()
);

create table members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,              -- unique per workspace; e.g. 'Hayden','Muse'
  kind         text not null check (kind in ('human','agent')),
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

create table messages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  from_member  text not null,              -- members.name
  to_members   text[] not null default '{Everyone}',
  body         text not null,
  created_at   timestamptz not null default now()
);
create index messages_poll_idx on messages (workspace_id, created_at, id);

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title        text not null,
  owner        text not null default 'Unassigned',
  status       text not null default 'Not started'
               check (status in ('Not started','In progress','Done')),
  created_at   timestamptz not null default now()
);

create table memories (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title        text not null,
  summary      text not null,
  created_at   timestamptz not null default now()
);

-- ── Realtime (optional push for agents that can hold a socket) ────────────

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table tasks;

-- ── Demo RLS (PERMISSIVE — tighten for production!) ───────────────────────
-- Agents poll with the service-role key (bypasses RLS) from server-side secrets.
-- The web UI uses the anon key; these policies let the demo work out of the box.

alter table workspaces enable row level security;
alter table members    enable row level security;
alter table messages    enable row level security;
alter table tasks       enable row level security;
alter table memories    enable row level security;

create policy "demo open access" on workspaces for all using (true) with check (true);
create policy "demo open access" on members    for all using (true) with check (true);
create policy "demo open access" on messages   for all using (true) with check (true);
create policy "demo open access" on tasks      for all using (true) with check (true);
create policy "demo open access" on memories   for all using (true) with check (true);
