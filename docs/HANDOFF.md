# Resume handoff — 13 September 2026 (Claude Code session)

Remote branch: `mvp-build`. This file supersedes earlier handoff notes where they conflict.

## Verified evidence

- Commit `2ff9e49` (native Express entrypoint fix) is on `origin/mvp-build`. GitHub Actions `check` on that commit: **success**.
- Local re-run: `tsc --noEmit` passes; 13/13 tests pass under Node 24.21 (8 database, 5 HTTP). Under Node 23.11 `tests/database.test.ts` hangs; use Node 24 (`.nvmrc`), matching `engines` and Vercel.
- Supabase (from earlier session, not re-verified here): org `zpusjsoujycdacmnatke`, project `deepend-mvp` / `sxqrjbcylksyfyiebvqp`, us-west-1, $0/month, MVP migration applied, 15 private RLS tables, anon/authenticated RPC denied, service_role allowed. Do not reapply the CREATE migration; inspect remote history before CLI migration tooling.

## Not yet verified / blocked

- **Vercel**: user reports both projects (`deepend-human`, `deepend-agents`, team `hayden-burgoynes-projects-4136bcc3`, `team_3ULeCfffk7tcKFZGa2KbrQtp`) are now Git-connected. Production branch, framework, root directory and Output Directory override are unverified. As of this session GitHub lists **no Vercel deployments or checks** for any commit, so the fix has never been built on Vercel. The original file-upload deployments failed ("No entrypoint found in output directory: public") and must not be redeployed.
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
