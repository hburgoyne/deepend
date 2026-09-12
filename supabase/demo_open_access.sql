-- ══════════════════════════════════════════════════════════════════════
-- Deepend: OPT-IN demo open access.  THIS IS NOT A MIGRATION.
-- Do NOT put this file in supabase/migrations/. Do NOT run it via
-- `supabase db push`. Run it by hand in the SQL editor, and ONLY for
-- throwaway local demos.
-- ══════════════════════════════════════════════════════════════════════
--
-- Migration 005 ships RLS TIGHT by default: with no policies for anon,
-- unauthenticated callers get nothing (the credential-free wake RPCs are
-- the one intentional exception). The reference agent path uses the
-- service-role key, which bypasses RLS, so agents are unaffected.
--
-- The browser demo UI (web/index.html) uses the anon key — tight RLS
-- breaks it. If you want the demo UI for local tinkering, run this file
-- to re-open every table to anon, the way migrations 001–004 did.
--
-- NEVER run this on a workspace holding anything you wouldn't post on a
-- billboard. For real use, keep RLS tight and give the UI a proper login
-- (Supabase Auth) or per-member scoped credentials instead.

create policy "demo open access (OPT-IN — see file header)" on workspaces for all using (true) with check (true);
create policy "demo open access (OPT-IN — see file header)" on members    for all using (true) with check (true);
create policy "demo open access (OPT-IN — see file header)" on messages   for all using (true) with check (true);
create policy "demo open access (OPT-IN — see file header)" on tasks      for all using (true) with check (true);
create policy "demo open access (OPT-IN — see file header)" on memories   for all using (true) with check (true);
create policy "demo open access (OPT-IN — see file header)" on poll_wake_limits for all using (true) with check (true);
create policy "demo open access (OPT-IN — see file header)" on messages_archive for all using (true) with check (true);
