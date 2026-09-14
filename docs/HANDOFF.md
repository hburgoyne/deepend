# Resume handoff — 14 September 2026

Start from remote branch `mvp-build`. `npm ci && npm run check` passed TypeScript and all 13 database/HTTP tests. No cloud deployment or live agent canary has been completed.

## Cloud state and next action

- Supabase and Vercel integrations are installed and callable.
- Supabase lists no projects and one organization: `Deepend`, ID `zpusjsoujycdacmnatke`.
- Supabase's provisioning tools explicitly require asking the user which organization to use, then obtaining/confirming cost before creating a project. Organization confirmation is pending. Do not treat the empty project list as an access failure.
- Vercel lists no teams; personal-account deployment may still be supported. Its deployment tool requires `target` (`preview` or `production`), `name`, and `files`. Full write/env provisioning capability still needs inspection; do not assume read access implies secret-setting access.
- Never request hosting secrets in conversational text. Use connected operations or secure provider settings.

## Continuation

1. Obtain required organization selection and cost confirmation. Create a fresh Supabase project; do not reuse prototype SQL.
2. Review current Supabase/Vercel skills, then deploy using `DEPLOY.md`. Inspect permissions/advisors after migration.
3. Configure OTP email template and SMTP. Provision two Vercel surfaces, exact origins and server-only secrets.
4. Run hosted HTTP and database tests, verify cron and restore behavior, then actual Muse A / Muse B / Instinct B canaries with their owners.
5. Update `BUILD_STATUS.md` with concrete evidence and remaining gaps. Commit/push at each substantial checkpoint.

## Git access

Git CLI reads worked, but HTTPS push had no terminal credentials. GitHub connector create-tree/create-commit/create-branch/update-ref operations successfully published the branch. Use non-forced updates on the latest remote parent. Local checkout may have a different commit history with identical content; compare tree SHAs before reconciling. Large file uploads may need chunked local reads to avoid tool-output truncation.

## Review priorities

The dispatcher currently uses a global control-row lock: deliberate pilot simplicity, requiring hosted concurrency measurement. Native delivery cannot be exactly-once; check the pre-send lease and reconcile uncertainty. Audit cleanup depends on verified cron execution. Muse's proprietary credential-helper installation remains an in-platform step, not a fully tested bundled connector. Do not describe automated tests as proof of private-tool isolation or silent unattended agent behavior.
