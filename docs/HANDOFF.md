# Latest handoff — 16 September 2026: signed wake hooks

Branch `mvp-build`. Fingerprint-approved hook pairing is implemented; see
[installation](../connectors/hook/README.md) and [API](API.md). Migration
`20260916133348_hook_pairing.sql` has been applied to production. Server-only RPC
permissions and the approval dispatcher branch were checked on production.
Local validation: TypeScript build, 30 Node 24 tests, three Python gate tests.

Owner approves a public fingerprint; helper keeps its Ed25519 private key locally.
Signed wake returns only pending, with timestamp/nonce replay protection. Pairing
lasts 90 days and still depends on a valid normal agent credential. Rotation
revokes pairings. Existing bearer wake gate remains available.

**Next live test:** install the helper in Muse's protected runtime, submit a public
proof using the existing connector, compare/approve the fingerprint, bind the
response, and verify signed status. Use the account canary in the installation
guide before disabling the old schedule. Proprietary adapter compatibility and
zero allowance consumption are not established by repository tests. No live room
messages, credentials or schedules were changed during implementation.

Recovery: expired worker reservation requires reconciling native sends before
clearing the matching run and repairing. Crashed filesystem locks require an
operator check. Instinct email wake bridge remains deferred.

---

# Wake-check rollout — 15 September 2026

Step 2: production migration `20260916040008_wake_checks` applied.
Restricted GET /v1/wake, owner-issued separate wake keys, and a portable non-model
Python gate are implemented. Actual Muse/Instinct hook API and allowance behavior
remain unverified; do not claim zero-cost scheduling until tested in-platform.
21 TypeScript/database/HTTP tests + 3 Python hook tests pass. Next: consolidate old
connector/spec instructions, review incoming Instinct hook, and verify deployments.

---

# Group-chat rollout — 15 September 2026

Step 1: production database migration `20260916035542_group_conversation` applied.
Human contact relays require stable source message IDs and reset the agent counter
once. Delivery payloads are server-generated, one full event per delivery; contacts
must loop to catch up and cannot skip discussion. Existing delivered history is
unchanged. Update installed agent instructions from docs/API.md before testing.
19 tests passed. Migration filenames now match production history (old mismatch resolved).
Next: restricted wake-check API, hook example, guide consolidation, live platform tests.

---

# Local onboarding update — 14 September 2026

Onboarding release (deployment requested by Hayden):
- Explicit Muse bearer API setup: state → one idempotent hello → events read-back;
  direct protocol links; explain background permissions before scheduling.
- Routine human setup executes saved drafts without extra review clicks. Sensitive
  changes retain readable confirmations. Human results use status messages and
  dedicated credential instructions instead of raw JSON.
- Browser-agent draft/confirmation protocol stays intact. No auth or schema changes.
- Hayden is handling signup and magic-link email templates separately.
- Validation: TypeScript build and 16 tests pass with cached Node 24.21.0.

Deployment uses the Git-linked production branch `mvp-build`. After deployment, test
room creation → Muse connection → one hello/read-back inside Muse. Live Muse
credentials and native scheduling approvals have not been tested here.

---

# Resume handoff — 13 September 2026 (Claude Code session)

Remote branch: `mvp-build`. This file supersedes earlier handoff notes.

## Verified state

**Code.** GitHub Actions `check` passed on `2ff9e49`. Local: `tsc --noEmit` passes; 13/13 tests pass on Node 24.21. `tests/database.test.ts` hangs on Node 23.11 — use Node 24 (`.nvmrc`).

**Vercel** (team `hayden-burgoynes-projects-4136bcc3`, `team_3ULeCfffk7tcKFZGa2KbrQtp`, Hobby):
- `deepend-human` (`prj_4CQPj06Totk2TJaZHS6EpSKjvQW1`) and `deepend-agents` (`prj_0oZS7HZqc7q51xNunjqN0jFPy53a`): Git-linked to `hburgoyne/deepend`, production branch `mvp-build` (verified: pushes create Production deployments), framework express, Node 24.x. Builds succeed.
- Public production origins: `https://deepend-human.vercel.app`, `https://deepend-agents.vercel.app`. The `…-hayden-burgoynes-projects-4136bcc3.vercel.app` aliases and previews are behind Vercel SSO (302) — never use them as origins.
- Production-only env vars on both, verified by `vercel env ls`: `DEEPEND_SURFACE`, `DEEPEND_HUMAN_ORIGIN`, `DEEPEND_AGENT_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`), `DEEPEND_ALLOWED_EMAILS` (3 pilot addresses), Sensitive `DEEPEND_APP_SECRET` and `CRON_SECRET` (generated in-shell, piped via stdin, identical across projects, never printed), Sensitive `SUPABASE_SERVICE_ROLE_KEY` (entered by owner). Preview env has none, so previews cannot reach production data.
- Live HTTP checks after deploying `2e95be6`: both `/` → 200 HTML; `/health` → `{"surface":"human|agent","status":"configured"}`; `/internal/maintenance` without secret → 401 on both; agent `/events` with no or invalid bearer → 401; bearer on human host → 404; `POST /auth/send` with foreign Origin → 403.
- CLI access: `npx -y vercel@59.16.0 -Q ~/.vercel-deepend --scope hayden-burgoynes-projects-4136bcc3 --non-interactive … --project <name>` (account `hburgoynedev-9719`). The default local CLI login (`hayden-usfolks`) cannot see these projects; CLI 44.2 device login fails with "Could not inspect token". The Vercel connector reads projects/deployments/logs but cannot write env vars or settings.

**Supabase** (org `zpusjsoujycdacmnatke`, project `deepend-mvp` / `sxqrjbcylksyfyiebvqp`, us-west-1, $0/month): ACTIVE_HEALTHY, Postgres 17.6. Earlier session verified 15 private RLS tables, anon/authenticated RPC denied, service_role allowed. Migration filenames now match production history (baseline `20260914022633`, group chat `20260916035542`, wake checks `20260916040008`). The local Supabase CLI is logged into another org; use the connector.

## Not yet verified

- Owner set Site URL, OTP expiry and service key. **Magic Link template (`{{ .Token }}`) and custom SMTP pending**: hosted Supabase's default sender only mails project team members and restricts template customisation, so custom SMTP is required for the pilot anyway.
- Database connectivity from Vercel (not proven by `/health` or 401s), human email-code login, rooms/invitations, agent activation, cron success (schedule `17 3 * * *`, human surface performs cleanup), hosted concurrency/restore, and all live Muse A / Muse B / Instinct B behaviour.

## Next actions

1. Owner configures custom SMTP, then edits the Magic Link template to show `{{ .Token }}`.
2. Owner requests a code at `https://deepend-human.vercel.app`; verify login, create a room, check runtime logs for errors.
3. Trigger maintenance with the cron secret (via Vercel cron run, not by printing the secret) and confirm success.
4. Invitation + confirmation for the second owner; create Muse A, Muse B, Instinct B; guide secure credential entry; hello/read-back; scheduled canaries per BUILD_STATUS.md.

## Implementation notes

Git push works from this machine; never force-update. Dispatcher uses an instance control-row lock for pilot simplicity; measure hosted contention. Native notifications cannot be guaranteed exactly-once. Muse's proprietary surrogate-helper installation remains an in-platform step. See API.md, RUNBOOK.md and connector guides.
