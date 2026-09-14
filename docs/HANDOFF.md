# Resume handoff — 14 September 2026

Remote branch: `mvp-build`. TypeScript and all 13 PGlite/HTTP tests pass. Implementation, migration, connector guides, deployment instructions and operator runbook are committed.

## Cloud state

- User explicitly approved creating the project in the **Deepend** Supabase organization (`zpusjsoujycdacmnatke`). Cost returned and confirmed through provisioning: **$0/month**.
- Project: `deepend-mvp`, ref `sxqrjbcylksyfyiebvqp`, region `us-west-1`, status ACTIVE_HEALTHY.
- Applied migration `deepend_mvp` from `supabase/migrations/202609130001_mvp.sql` using Supabase migration tool. Do not reapply its CREATE statements. Inspect remote migration history before future CLI synchronization.
- Hosted checks: 15 private tables, all RLS enabled; anon and authenticated cannot execute `deepend_call`; service_role can; invalid agent credential returns unauthorized.
- Security advisor: only INFO `rls_enabled_no_policy` notices for the private schema. Default-deny direct client access is intentional; do not add permissive policies to silence these notices.
- Vercel integration is connected; team list was empty. Personal-account deployment may still be supported. The deployment tool requires `target`, `name`, `files`; complete env/project setup capability remains unverified.
- No Vercel deployment, SMTP setup, or live agent canary has been completed. Never request secrets in conversational text.

## Next actions

1. Configure Supabase email OTP template and SMTP; inspect supported secure credential transfer to Vercel. Existing Supabase tools expose publishable keys but no general secret-key/auth-configuration operation was discovered. Use supported provider setup; do not extract internal platform secrets through SQL.
2. Deploy human and agent Vercel surfaces with exact HTTPS origins and server-only environment variables following DEPLOY.md. Test cron authorization and cleanup.
3. Run hosted concurrency, HTTP, Auth and restore checks, then connect the actual Muse A, Muse B and Instinct B through each owner's secure platform flow.
4. Test closed-app scheduled writes, silent secondary work, notification uncertainty and contact switching. Update BUILD_STATUS.md with evidence; do not equate automated tests with platform compatibility.

## Git and implementation notes

Git CLI reads work; HTTPS push lacked credentials. GitHub connector tree/commit/branch/ref operations publish successfully. Use the latest remote commit as parent and never force-update. Local history may differ despite identical tree contents; synchronize carefully. Large uploads need chunked reads to avoid tool truncation.

Dispatcher uses an instance control-row lock for pilot simplicity; measure hosted contention. Native notifications cannot be guaranteed exactly-once. Audit retention needs the deployed maintenance cron. Muse's proprietary surrogate-helper installation remains an in-platform step. See API.md, RUNBOOK.md and connector guides for operating contracts.
