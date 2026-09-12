-- Semantic test for migration 005. Scratch DB only.
-- HOW TO RUN (psql, against a scratch database — never production):
--   create role anon nologin; create role authenticated nologin;
--   create role service_role nologin;
--   create publication supabase_realtime;  -- Supabase provides this; 001 expects it
--   \i supabase/migrations/001_schema.sql
--   \i supabase/migrations/002_workspace_config.sql
--   \i supabase/migrations/003_heartbeats.sql
--   \i supabase/migrations/004_wake_endpoint.sql
--   \i supabase/migrations/005_hardening.sql
--   \i supabase/tests/test_005.sql
-- Every row printed should show pass = t.
\set ON_ERROR_STOP on

-- ── fixtures ──
insert into workspaces (name, dream_owner) values ('Test', 'Muse') returning id \gset
insert into members (workspace_id, name, kind) values
  (:'id', 'Hayden', 'human'),
  (:'id', 'Kristina', 'human'),
  (:'id', 'Muse', 'agent'),
  (:'id', 'bud', 'agent');

-- TEST 1: client-supplied created_at is ignored
insert into messages (workspace_id, from_member, body, created_at)
  values (:'id', 'Hayden', 'backdated?', '2000-01-01 00:00:00+00');
select 'T1 created_at forced to now' as test,
       (created_at > now() - interval '1 minute') as pass
  from messages where body = 'backdated?';

-- TEST 2: turn cap — 3 consecutive agent rows ok, 4th rejected
insert into messages (workspace_id, from_member, body) values
  (:'id', 'Muse', 'a1'), (:'id', 'bud', 'a2'), (:'id', 'Muse', 'a3');
select 'T2 three agent rows accepted' as test, (count(*) = 4) as pass
  from messages where workspace_id = :'id';

\set ON_ERROR_STOP off
insert into messages (workspace_id, from_member, body) values (:'id', 'bud', 'a4-should-fail');
\set ON_ERROR_STOP on
select 'T2 fourth agent row rejected' as test, (count(*) = 4) as pass
  from messages where workspace_id = :'id';

insert into messages (workspace_id, from_member, body) values (:'id', 'Hayden', 'humans here');
insert into messages (workspace_id, from_member, body) values (:'id', 'Muse', 'a5-after-human');
select 'T2 agent ok after human row' as test, (count(*) = 6) as pass
  from messages where workspace_id = :'id';

-- TEST 3: rate limit (tighten config for the test, then restore)
update workspaces set config = config || '{"max_writes_per_minute": 2}' where id = :'id';
insert into messages (workspace_id, from_member, body) values (:'id', 'Kristina', 'r1');
insert into messages (workspace_id, from_member, body) values (:'id', 'Kristina', 'r2');
\set ON_ERROR_STOP off
insert into messages (workspace_id, from_member, body) values (:'id', 'Kristina', 'r3-should-fail');
\set ON_ERROR_STOP on
select 'T3 3rd write within a minute rejected' as test,
       ((select count(*) from messages where body in ('r1','r2','r3-should-fail')) = 2) as pass;
update workspaces set config = config || '{"max_writes_per_minute": 30}' where id = :'id';

-- TEST 4: archive moves only rows below min LIVE watermark; move not delete
-- (distinct backdate times so row-ordering is deterministic)
update messages set created_at = now() - interval '5 days' where body = 'backdated?';
update messages set created_at = now() - interval '4 days' where body in ('a1','a2','a3');
update members set last_poll_at = now(),
  watermark_created_at = (select created_at from messages where body='a5-after-human'),
  watermark_id = (select id from messages where body='a5-after-human')
  where name = 'Muse' and workspace_id = :'id';
update members set last_poll_at = now(),
  watermark_created_at = (select created_at from messages where body='a1'),
  watermark_id = (select id from messages where body='a1')
  where name = 'bud' and workspace_id = :'id';
-- Hayden/Kristina: stale heartbeat (must NOT block)

select deepend_archive(:'id') as first_call;   -- expect 1 ('backdated?' only)
select deepend_archive(:'id') as second_call;  -- expect 0
select 'T4 moved exactly the eligible row, to archive' as test,
  (select count(*) from messages_archive where body = 'backdated?') = 1
  and (select count(*) from messages where body = 'backdated?') = 0
  and (select count(*) from messages where body = 'a1') = 1 as pass;

-- TEST 5: refusal — live member with null watermark blocks archival
update messages set created_at = now() - interval '4 days' where body = 'a2';
update members set last_poll_at = now(), watermark_created_at = null, watermark_id = null
  where name = 'bud' and workspace_id = :'id';
select deepend_archive(:'id') as refused_call;  -- expect 0
select 'T5 archive refuses when a live member has no watermark' as test,
  (select count(*) from messages where body = 'a2') = 1 as pass;

-- TEST 6: RLS — anon sees nothing via tables, wake RPC still works
set role anon;
select 'T6 anon table read denied (0 rows)' as test, (count(*) = 0) as pass from messages;
reset role;
select 'T6 wake RPC works credential-free' as test,
  has_new_since((select poll_token from members where name='Muse' and workspace_id=:'id'),
                now() - interval '1 hour') as pass;
