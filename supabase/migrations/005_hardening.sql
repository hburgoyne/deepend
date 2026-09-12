-- Deepend migration 005: server-side hardening.
--
-- The critique this adopts: behavioral rules that live only in a prompt are
-- suggestions. This migration moves the load-bearing ones into Postgres,
-- where they hold even when an agent is confused, buggy, or compromised:
--   1. Agent turn cap enforced by a BEFORE INSERT trigger (rejects the write).
--   2. Per-member write rate limit (runaway backstop).
--   3. created_at forced server-side (client clock skew can't break ordering).
--   4. Archive is move-not-delete, and only below the minimum watermark of
--      heartbeat-live members (a lagging agent never silently skips rows).
--   5. RLS ships TIGHT by default. The permissive demo policies are dropped;
--      re-enable them only via the explicit opt-in supabase/demo_open_access.sql
--      (NOT a migration — run it by hand, only for throwaway local demos).

-- ── 0. New tunable ──────────────────────────────────────────────────────

alter table workspaces
  alter column config set default '{"max_agent_turns": 3, "max_writes_per_minute": 30}';

update workspaces
   set config = config || '{"max_writes_per_minute": 30}'::jsonb
 where not (config ? 'max_writes_per_minute');

-- ── 1. Force created_at server-side ──────────────────────────────────────
-- Clients may still SEND created_at (PostgREST allows the column), but the
-- value is ignored: ordering and watermarks can never be skewed by a client
-- clock again.

create or replace function deepend_force_created_at()
returns trigger
language plpgsql
as $$
begin
  NEW.created_at := now();
  return NEW;
end;
$$;

comment on function deepend_force_created_at() is
  'BEFORE INSERT: ignores any client-supplied created_at, stamps now(). Ordering and watermarks are server-truth.';

drop trigger if exists messages_force_created_at on messages;
create trigger messages_force_created_at
  before insert on messages
  for each row execute function deepend_force_created_at();

drop trigger if exists tasks_force_created_at on tasks;
create trigger tasks_force_created_at
  before insert on tasks
  for each row execute function deepend_force_created_at();

drop trigger if exists memories_force_created_at on memories;
create trigger memories_force_created_at
  before insert on memories
  for each row execute function deepend_force_created_at();

-- ── 2. Server-side agent turn cap ────────────────────────────────────────
-- Rejects the (max_agent_turns+1)-th consecutive agent-authored row in the
-- workspace stream. Humans always pass; only a human row resets the count.
-- Unregistered from_member names are treated as agents (fail closed).
--
-- The reference schema has one conversation per workspace, so the run is
-- counted workspace-wide. If threads are added later, scope the inner query
-- to NEW.thread_id.

create or replace function deepend_enforce_agent_turn_cap()
returns trigger
language plpgsql
as $$
declare
  v_kind text;
  v_max_turns int;
  v_run int := 0;
  r record;
begin
  select kind into v_kind from members
   where workspace_id = NEW.workspace_id and name = NEW.from_member;

  if v_kind = 'human' then
    return NEW;
  end if;

  select greatest(coalesce((config->>'max_agent_turns')::int, 3), 1)
    into v_max_turns
    from workspaces where id = NEW.workspace_id;

  for r in
    select coalesce(mem.kind, 'agent') as k
      from messages m
      left join members mem
        on mem.workspace_id = m.workspace_id
       and mem.name = m.from_member
     where m.workspace_id = NEW.workspace_id
     order by m.created_at desc, m.id desc
     limit v_max_turns
  loop
    exit when r.k is distinct from 'agent';
    v_run := v_run + 1;
  end loop;

  if v_run >= v_max_turns then
    raise exception
      'deepend: agent turn cap reached (max_agent_turns=%) — a human must post before agents continue',
      v_max_turns;
  end if;
  return NEW;
end;
$$;

comment on function deepend_enforce_agent_turn_cap() is
  'BEFORE INSERT on messages: rejects agent-authored rows beyond max_agent_turns consecutive agent-only rows. The loop-breaker for two agents politely clarifying each other forever.';

drop trigger if exists messages_agent_turn_cap on messages;
create trigger messages_agent_turn_cap
  before insert on messages
  for each row execute function deepend_enforce_agent_turn_cap();

-- ── 3. Per-member write rate limit ───────────────────────────────────────
-- Backstop against a runaway agent (the "400 rows" scenario). Nothing in the
-- protocol stops a buggy loop from writing; this does. Tunable per workspace
-- via config.max_writes_per_minute (default 30).

create or replace function deepend_enforce_write_rate_limit()
returns trigger
language plpgsql
as $$
declare
  v_max_per_min int;
  v_recent int;
begin
  select coalesce((config->>'max_writes_per_minute')::int, 30)
    into v_max_per_min
    from workspaces where id = NEW.workspace_id;

  select count(*) into v_recent
    from messages
   where workspace_id = NEW.workspace_id
     and from_member = NEW.from_member
     and created_at > now() - interval '1 minute';

  if v_recent >= v_max_per_min then
    raise exception
      'deepend: write rate limit exceeded (%/min for "%") — slow down',
      v_max_per_min, NEW.from_member;
  end if;
  return NEW;
end;
$$;

comment on function deepend_enforce_write_rate_limit() is
  'BEFORE INSERT on messages: rejects writes beyond max_writes_per_minute per member. Runaway backstop.';

drop trigger if exists messages_write_rate_limit on messages;
create trigger messages_write_rate_limit
  before insert on messages
  for each row execute function deepend_enforce_write_rate_limit();

-- ── 4. Watermark-safe archive (move, never delete) ──────────────────────
-- The dream MOVES rows — it never deletes them. And it may only move rows
-- that EVERY live member has provably seen: strictly below the minimum
-- watermark across members with a fresh heartbeat. A lagging agent's unread
-- rows stay put, so nobody silently skips messages they never read.
-- Stale members (dead heartbeat) don't block: their rows are covered by
-- the memories digest when they return.

create table messages_archive (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  from_member  text not null,
  to_members   text[] not null default '{Everyone}',
  body         text not null,
  created_at   timestamptz not null default now(),
  archived_at  timestamptz not null default now()
);
alter table messages_archive enable row level security;
-- No policies: default-deny for anon. Service-role (the reference agent
-- path) bypasses RLS.
-- (Columns mirror messages@001 deliberately instead of LIKE, so a future
--  schema change can't silently reshape cold storage.)

comment on table messages_archive is
  'Cold storage for dreamed messages. Rows are MOVED here by deepend_archive(), never deleted. Same shape as messages plus archived_at.';

create or replace function deepend_archive(p_workspace_id uuid)
returns int
language plpgsql
as $$
declare
  v_wm_created timestamptz;
  v_wm_id uuid;
  v_moved int;
begin
  -- A live member with no watermark yet has provably seen nothing: refuse.
  if exists (
    select 1 from members
     where workspace_id = p_workspace_id
       and last_poll_at > now() - interval '15 minutes'
       and watermark_id is null
  ) then
    raise notice 'deepend: archive refused — a live member has no watermark yet';
    return 0;
  end if;

  -- Minimum watermark across heartbeat-live members.
  select watermark_created_at, watermark_id
    into v_wm_created, v_wm_id
    from members
   where workspace_id = p_workspace_id
     and last_poll_at > now() - interval '15 minutes'
     and watermark_id is not null
   order by watermark_created_at asc, watermark_id asc
   limit 1;

  if v_wm_id is null then
    raise notice 'deepend: archive refused — no live member watermark';
    return 0;
  end if;

  with moved as (
    delete from messages
     where workspace_id = p_workspace_id
       and created_at < now() - interval '3 days'
       and (created_at, id) < (v_wm_created, v_wm_id)
    returning id, workspace_id, from_member, to_members, body, created_at
  )
  insert into messages_archive
    (id, workspace_id, from_member, to_members, body, created_at)
  select id, workspace_id, from_member, to_members, body, created_at
    from moved;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

comment on function deepend_archive(uuid) is
  'Dream archival: MOVES messages older than 3 days AND strictly below the minimum watermark of heartbeat-live members into messages_archive. Never deletes. Returns the moved count; returns 0 (with a notice) when it refuses.';

-- ── 5. RLS: tight by default ─────────────────────────────────────────────
-- Drop the permissive demo policies. With RLS enabled and no policies for
-- anon, unauthenticated callers get NOTHING — except the wake RPCs, which
-- are SECURITY DEFINER and intentionally credential-free (004).
--
-- The reference agent path uses the service-role key (bypasses RLS) from
-- server-side secrets. The browser demo UI (web/) uses the anon key, so it
-- needs the explicit opt-in escape hatch: supabase/demo_open_access.sql
-- (NOT a migration — run it by hand, only for throwaway local demos).

drop policy "demo open access" on workspaces;
drop policy "demo open access" on members;
drop policy "demo open access" on messages;
drop policy "demo open access" on tasks;
drop policy "demo open access" on memories;
drop policy "demo open access" on poll_wake_limits;
-- messages_archive was created tight (no policies); nothing to drop.
