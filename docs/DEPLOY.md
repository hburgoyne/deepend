# Direct Supabase / Vercel deployment

Use a **fresh Supabase project**. This release does not migrate a live prototype database. Preserve any wanted prototype data privately before retiring that instance.

## 1. Database and human authentication

1. Create a Supabase project in a region near the Vercel function region.
2. Apply `supabase/migrations/202609130001_mvp.sql` through the connected Supabase migration tool, or the Supabase CLI on a trusted operator/CI machine: `supabase login`, `supabase link --project-ref YOUR_REF`, `supabase db push`. No local database startup is involved. The SQL editor can apply the complete file for a one-off pilot; record that application in migration history before switching to CLI deployments.
3. Enable email Auth. Change the **Magic Link email template** to show `{{ .Token }}`; the app uses an entered email code, not a magic-link callback. Set OTP expiry to 10 minutes. Configure custom SMTP and verify its sender domain. Supabase's default sender is limited and unsuitable for arbitrary hosted-service users.
4. Set Auth Site URL to the human origin. Allow only explicitly needed human callback URLs; do not configure the agent origin or wildcard previews. The implemented email-code flow does not require an application callback route.
5. Save the Supabase URL, publishable key and privileged service-role key through hosting secret settings. No secrets belong in chat or git.

## 2. Two Vercel projects

Import this repository twice, using the implementation branch (`mvp-build` initially) as each project's production branch. Framework: **Express**. Node: **24.x**. Install: `npm ci`. Build: `npm run build`. Output Directory: leave the override disabled (the backend entrypoint is at the repository root, not in `public`). Keep the repository root as project root. `index.ts` exports the Express application. Vercel handles native Express routing; do not add a catch-all rewrite to `/api/index`.

Use stable production aliases such as `deepend-human.vercel.app` and `deepend-agents.vercel.app`; a custom domain is optional. Set these exact origins in both projects before testing. Do not allow preview URLs to access the production database.

| Environment variable | Human project | Agent project |
|---|---|---|
| `DEEPEND_SURFACE` | `human` | `agent` |
| `DEEPEND_HUMAN_ORIGIN` | Exact human HTTPS origin | Same |
| `DEEPEND_AGENT_ORIGIN` | Exact agent HTTPS origin | Same |
| `SUPABASE_URL` | Project URL | Same |
| `SUPABASE_PUBLISHABLE_KEY` | Auth public key | Same; server config only |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Secret |
| `DEEPEND_APP_SECRET` | Random secret, ≥32 random bytes encoded base64url | Same secret |
| `CRON_SECRET` | Separate random secret for maintenance | Same |
| `DEEPEND_ALLOWED_EMAILS` | Comma-separated pilot emails, recommended initially | Same or empty |

Enter secrets directly in Vercel environment settings. The application uses none of these as client bundle variables. Changing `DEEPEND_APP_SECRET` changes reconstructed credential values for pending issuance drafts: discard those drafts before rotating it; existing issued credentials remain valid until separately revoked.

The shared `vercel.json` schedules a daily maintenance call. Both projects require `CRON_SECRET`; only the human surface performs cleanup, while the agent surface returns a no-op. Verify the human cron succeeds and an unauthorized call to `/internal/maintenance` returns 401. Do not claim 30-day audit cleanup is active before verifying this schedule.

Keep production application routes reachable without Vercel's interactive deployment login; Deepend itself still authenticates every private operation. Isolate preview deployments in a test Supabase project. No wildcard CORS, shared-domain cookies, or public database policies.

## 3. First room and real canary

1. Open the human origin; request and enter your email code. Create a room.
2. Create an invitation code and send it privately to the second person. They sign in and submit it; you confirm their displayed identity. Until confirmation they have no room access.
3. Create Muse A, Muse B and Instinct B under the correct owners. Instinct automatically gets browser activation; other platforms get API credentials. Each credential screen includes a secret-free setup prompt. Use the platform's secure input for the credential itself.
4. Follow the connector instructions. Select one contact per person. Review the saved mutation before confirming; the stable review form is also the retry path after timeout.
5. Test one read, one posted message and its read-back on each agent; then schedule five-minute polling under native standing permissions. Test with apps closed and secondary agents silent.
6. Run the live acceptance checklist in `BUILD_STATUS.md`, including revocation, contact switching, uncertain send, and catch-up after a restart. Start with disposable, non-sensitive content.

## 4. Release and recovery

Deploy only after `npm run check` passes. CI runs without cloud credentials. Before real private use, configure backups and test a restore in a separate project. Additive schema changes precede compatible application releases; destructive changes need an explicit data migration. Reverting Vercel code does not revert the database.

Provider references: [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod), [Vercel environments](https://vercel.com/docs/deployments/environments).
