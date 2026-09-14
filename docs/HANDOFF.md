# Resume handoff — 13 September 2026 (Claude Code session)

Remote branch: `mvp-build`. This file supersedes earlier handoff notes where they conflict.

## Verified evidence

- Commit `2ff9e49` (native Express entrypoint fix) is on `origin/mvp-build`. GitHub Actions `check` on that commit: **success**.
- Local re-run: `tsc --noEmit` passes; 13/13 tests pass under Node 24.21 (8 database, 5 HTTP). Under Node 23.11 `tests/database.test.ts` hangs; use Node 24 (`.nvmrc`), matching `engines` and Vercel.
- Supabase (from earlier session, not re-verified here): org `zpusjsoujycdacmnatke`, project `deepend-mvp` / `sxqrjbcylksyfyiebvqp`, us-west-1, $0/month, MVP migration applied, 15 private RLS tables, anon/authenticated RPC denied, service_role allowed. Do not reapply the CREATE migration; inspect remote history before CLI migration tooling.

## Not yet verified / blocked

- **Vercel Git link verified**: pushing `399c455` created GitHub deployments for both projects (`deepend-human`, `deepend-agents`, team `hayden-burgoynes-projects-4136bcc3`, `team_3ULeCfffk7tcKFZGa2KbrQtp`). Both Vercel builds reported **success** — first successful build of the Express entrypoint fix (the old "No entrypoint found in output directory: public" error did not recur). Deployment URLs `deepend-human-9xusttilh-…vercel.app`, `deepend-agents-6v0zzlhry-…vercel.app`.
- They were **Preview** deployments (`production_environment: false`), so the production branch is still not `mvp-build`. Previews redirect (302) to Vercel SSO, as DEPLOY.md requires. The expected production aliases `deepend-{human,agents}-hayden-burgoynes-projects-4136bcc3.vercel.app` return 404 `DEPLOYMENT_NOT_FOUND`: no production deployment exists. Runtime behaviour (503 `configuration_required` before env vars) is not yet observed. Confirm the actual assigned production domains before setting `DEEPEND_*_ORIGIN`, since the app enforces exact hosts; prefer a production domain that is not behind Vercel Authentication.
- The original file-upload deployments failed and must not be redeployed.
- **Update (after owner set production branches; Vercel + Supabase connectors now attached):** `deepend-human` has a READY production deployment (`dpl_HJXpod86ngqhNR4LKxuMNTGQ5TWu`), framework express, Node 24.x, domains `deepend-human.vercel.app` (public) and the team alias (SSO-protected, 302). `https://deepend-human.vercel.app/` returns **503 `configuration_required`, no-store** — the Express function runs; env vars absent. Use `https://deepend-human.vercel.app` as `DEEPEND_HUMAN_ORIGIN`.
- `deepend-agents` (framework express, Node 24.x) had **no production deployment** at that point: only the failed file upload (production, ERROR) and two READY previews. `deepend-agents.vercel.app` returned 404. Its only domain was the SSO-protected team alias. Verify its production branch and assigned public domain before setting `DEEPEND_AGENT_ORIGIN`.
- Vercel connector exposes project/deployment/log reads but **no environment-variable or project-settings write**; env vars need the dashboard or an authorized CLI.
- Supabase connector verified `deepend-mvp` ACTIVE_HEALTHY (Postgres 17.6). Remote migration history: `20260914022633 deepend_mvp`. The local file is `202609130001_mvp.sql` — **versions differ**, so `supabase db push` would try to reapply the CREATE migration. Repair history (`supabase migration repair`) or align the filename before using CLI migrations.
- Local Vercel CLI default login is a different account (`hayden-usfolks`, team `hayden-burgoynes-projects`) and cannot see these projects. An isolated login (`vercel login --future -Q ~/.vercel-deepend`) was started twice; both device codes expired unapproved. Retry when the owner is present, then use `-Q ~/.vercel-deepend --scope hayden-burgoynes-projects-4136bcc3` for all commands.
- Local Supabase CLI login is the Us Folks org and cannot see `deepend-mvp`.
- Claude in Chrome extension was not connected.
- Environment variables, Supabase email OTP template/SMTP, cron, hosted auth, and all live agent behavior: not configured / not verified.

## Next actions

1. Owner approves Vercel device login for the correct account. Then per project: confirm Git repo link and set production branch `mvp-build`; framework Express, root `.`, Node 24.x, no Output Directory override.
2. Deploy `mvp-build` HEAD via Git, inspect build logs, confirm `/` returns 503 `configuration_required` (expected before env vars).
3. Set server-only env vars per DEPLOY.md. Generate `DEEPEND_APP_SECRET` / `CRON_SECRET` and pipe directly into `vercel env add` (never print). Supabase URL/keys: owner enters them in Vercel settings, or pipe from an authorized Supabase CLI without printing.
4. Owner configures Supabase Magic Link template with `{{ .Token }}`, 10-minute OTP expiry, custom SMTP, Site URL = human origin.
5. Redeploy; verify human OTP login, 401 on unauthorized `/internal/maintenance`, host separation, then room/invite/agent activation and live canaries per BUILD_STATUS.md.

## Git and implementation notes

Git push over the local credential helper works from this machine. Never force-update. Dispatcher uses an instance control-row lock for pilot simplicity; measure hosted contention. Native notifications cannot be guaranteed exactly-once. Audit retention needs the deployed maintenance cron. Muse's proprietary surrogate-helper installation remains an in-platform step. See API.md, RUNBOOK.md and connector guides.
