-- Deepend migration 004: credential-free wake endpoint.
--
-- Design: separate the WAKE SIGNAL from the DATA FETCH.
--   * Wake signal: POST /rest/v1/rpc/has_new_since  {"p_poll_token","p_since"}
--     → true/false. No credentials needed. A hook script, edge function, or
--     any poller can call this cheaply holding nothing but the member's token.
--   * Data fetch: the normal authenticated REST reads (RLS + member key).
--     Only a woken agent holding real credentials ever reads message bodies.
--
-- SECURITY BOUNDARY: has_new_since is SECURITY DEFINER — it bypasses RLS by
-- design, which makes the function itself the boundary. It MUST return only
-- a boolean: no content, no counts, no authors, no timestamps. Audit this
-- function if you ever change it. If per-thread or per-recipient visibility
-- is added later, mirror those rules inside it.

-- Each member gets an unguessable poll token at creation. It is a WEAK
-- capability: it reveals at most one bit ("anything new since T?") and can
-- never read content. Leaking it leaks activity timing, nothing more.
alter table members
  add column poll_token text not null default gen_random_uuid()::text;

create unique index members_poll_token_uidx on members (poll_token);

comment on column members.poll_token is
  'Weak capability for the credential-free wake check. Grants only the has_new_since bit, never message content. Rotate with rotate_poll_token().';

-- Per-token throttle for the public endpoint: minimum 2s between wake
-- checks (≈30/min). Generous for a 5–10s poller, tight enough to blunt
-- casual abuse. Races fail open (an extra call slips through) — safe.
-- Production deployments should ALSO throttle at the edge / WAF.
create table poll_wake_limits (
  poll_token text primary key,
  last_call  timestamptz not null default now()
);

-- Same demo-grade RLS convention as the other tables (permissive; the wake
-- function is SECURITY DEFINER and bypasses RLS by design).
alter table poll_wake_limits enable row level security;
create policy "demo open access" on poll_wake_limits for all using (true) with check (true);

create or replace function has_new_since(p_poll_token text, p_since timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_last_call timestamptz;
begin
  -- 1. Resolve the token. Unknown token → error, NOT false: callers must be
  --    able to distinguish "nothing new" from "bad token".
  select m.workspace_id into v_workspace_id
    from members m where m.poll_token = p_poll_token;
  if not found then
    raise exception 'unknown poll token';
  end if;

  -- 2. Throttle. Throttled callers get an error (back off and retry) — a
  --    throttle is never reported as "nothing new", which would lose wakeups.
  select last_call into v_last_call
    from poll_wake_limits where poll_token = p_poll_token for update;
  if found and v_last_call > now() - interval '2 seconds' then
    raise exception 'rate_limited: minimum 2s between wake checks';
  end if;
  insert into poll_wake_limits (poll_token, last_call)
    values (p_poll_token, now())
    on conflict (poll_token) do update set last_call = now();

  -- 3. The one-bit answer. created_at (not id) is the ordering key — ids are
  --    random UUIDs. >= is deliberate: pass the timestamp you CHECKED at and
  --    you can't miss rows that arrived mid-poll; the follow-up watermark
  --    poll is authoritative and dedupes.
  return exists (
    select 1 from messages
    where workspace_id = v_workspace_id
      and created_at >= p_since
  );
end;
$$;

comment on function has_new_since(text, timestamptz) is
  'SECURITY DEFINER wake oracle: true iff the token holder''s workspace has messages with created_at >= p_since. Returns ONLY a boolean. Throttled to ~30 calls/min per token.';

-- Expose to unauthenticated callers: PostgREST publishes functions the anon
-- role can EXECUTE. This grant is what makes the endpoint credential-free.
grant execute on function has_new_since(text, timestamptz) to anon;

-- Token rotation. No anon grant here: call it with the member's own
-- credential (service-role in the demo setup). In hardened deployments,
-- restrict further so a member can only rotate its own token.
create or replace function rotate_poll_token(p_member_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_new text := gen_random_uuid()::text;
begin
  select poll_token into v_old from members where id = p_member_id for update;
  if not found then
    raise exception 'unknown member';
  end if;
  update members set poll_token = v_new where id = p_member_id;
  delete from poll_wake_limits where poll_token = v_old;
  return v_new;
end;
$$;

comment on function rotate_poll_token(uuid) is
  'Issues a fresh poll token for a member. Restrict to the member''s own credential when RLS is tightened.';
