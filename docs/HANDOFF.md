# Resume handoff — 14 September 2026

Remote branch: `mvp-build`. TypeScript and all 13 PGlite/HTTP tests pass. Implementation, migration, connector guides, deployment instructions and operator runbook are committed.

## Cloud state

- User explicitly approved creating the project in the **Deepend** Supabase organization (`zpusjsoujycdacmnatke`). Cost returned and confirmed through provisioning: **$0/month**.
- Project: `deepend-mvp`, ref `sxqrjbcylksyfyiebvqp`, region `us-west-1`, status ACTIVE_HEALTHY.
- Applied migration `deepend_mvp` from `supabase/migrations/202609130001_mvp.sql` using Supabase migration tool. Do not reapply its CREATE statements. Inspect remote migration history before future CLI synchronization.
- Hosted checks: 15 private tables, all RLS enabled; anon and authenticated cannot execute `deepend_call`; service_role can; invalid agent credential returns unauthorized.
- Security advisor: only INFO `rls_enabled_no_policy` notices for the private schema. Default-deny direct client access is intentional; do not add permissive policies to silence these notices.
- Vercel accepted two production deployments from the committed application files (no secrets embedded):
  - Human: `dpl_GSo8NJst22r7tnEpbfffNXsrobW3`; alias `deepend-human-hayden-burgoynes-projects-4136bcc3.vercel.app`.
  - Agent: `dpl_HHxUS6761L8GmNKwfnVW9GUepPPq`; alias `deepend-agents-hayden-burgoynes-projects-4136bcc3.vercel.app`.
- Initial state was INITIALIZING. Build readiness is **not verified**. Vercel inspection returned 403 for scope `hayden-burgoynes-projects-4136bcc3`, team ID `team_3ULeCfffk7tcKFZGa2KbrQtp`, requesting reauthentication to that scope. Reconnect with authorized scope before further inspection/configuration; do not bypass it.
- Environment variables have not been configured. The application intentionally returns configuration_required until they are supplied. No live site functionality, SMTP setup or native-agent canary is claimed.
- These were file-based deployments, not a verified Git-linked auto-deploy setup. Do not assume later Git pushes deploy automatically.

## Next actions

1. Configure Supabase email OTP template and SMTP; inspect supported secure credential transfer to Vercel. Existing Supabase tools expose publishable keys but no general secret-key/auth-configuration operation was discovered. Use supported provider setup; do not extract internal platform secrets through SQL.
2. Reauthenticate the Vercel integration for the identified scope, inspect both existing deployments, configure server-only environment variables and exact origins using the aliases above, then redeploy. Verify Git linkage if desired and test cron authorization/cleanup.
3. Run hosted concurrency, HTTP, Auth and restore checks, then connect the actual Muse A, Muse B and Instinct B through each owner's secure platform flow.
4. Test closed-app scheduled writes, silent secondary work, notification uncertainty and contact switching. Update BUILD_STATUS.md with evidence; do not equate automated tests with platform compatibility.

## Git and implementation notes

Git CLI reads work; HTTPS push lacked credentials. GitHub connector tree/commit/branch/ref operations publish successfully. Use the latest remote commit as parent and never force-update. Local history may differ despite identical tree contents; synchronize carefully. Large uploads need chunked reads to avoid tool truncation.

Dispatcher uses an instance control-row lock for pilot simplicity; measure hosted contention. Native notifications cannot be guaranteed exactly-once. Audit retention needs the deployed maintenance cron. Muse's proprietary surrogate-helper installation remains an in-platform step. See API.md, RUNBOOK.md and connector guides for operating contracts.
