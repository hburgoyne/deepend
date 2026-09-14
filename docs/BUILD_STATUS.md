# MVP build checkpoint

Branch: `mvp-build`. Source implementation replaces the prototype; specifications remain under `docs/`.

## Implemented

- Supabase migration with private schema/RLS, server-only RPC, hashed scoped credentials, email-auth identity mapping and human sessions.
- Separate human and agent Vercel surfaces, exact-host checks, Secure/HttpOnly cookies, CSRF/Origin enforcement, inert server-rendered HTML and no-store private responses.
- Human email OTP setup; private rooms; invitation acceptance plus inviter confirmation; administrator promotion/removal; secure connection issuance/rotation/revocation; contact settings; export/delete.
- Muse-compatible REST operation contract; Instinct activation/browser forms, durable drafts and receipts; optional OpenClaw reference API client.
- Ordered events, attention recipients, message budgets, processing cursors/batches, task assignment/leases/fencing, stable mutation IDs and receipt recovery.
- Single-contact delivery preparation/claim/recheck/outcome; uncertain-send blocking and owner reconciliation. Native delivery itself belongs to the connected platform.
- Transactional rate limits, kill switch, metadata-only audit and authenticated maintenance cron configuration.
- Deployment instructions, connector guides, CI and operator runbook.

## Verification

On 14 September 2026, `npm run check` passed TypeScript validation and all 13 PGlite/HTTP tests. CI will rerun on push. These test private access, spoofed identity, budget/sequence allocation, leases, batches, invitations, contact exclusivity, uncertain delivery, activation/revocation/expiry, public SQL denial, CSRF, host/session separation, rendering and retry responses.

On 13 September 2026 GitHub Actions passed on `2ff9e49`, and a local re-run passed 13/13 under Node 24.21 (the database test hangs under Node 23; use `.nvmrc`).

Supabase project `deepend-mvp` (`sxqrjbcylksyfyiebvqp`, US West) is active and the MVP migration is applied. The original Vercel file deployments failed (no entrypoint in `public`); Git linkage is verified: `399c455` built successfully on both projects, but as Preview deployments; production branch, env vars and runtime behaviour are not yet verified. See HANDOFF.md for IDs, aliases and the CLI access state. Environment variables and Supabase email configuration are still pending. The Deepend organization was confirmed by the user; Supabase quoted $0/month. Hosted SQL checks verified 15 private RLS-enabled tables, denied anon/authenticated RPC access, allowed service-role RPC access, and rejected an invalid agent credential. The security advisor returned only expected INFO notices for default-deny private tables. Do not paste hosting tokens or agent credentials into chat to unblock it; connect the providers or enter secrets directly in their secure settings.

## Deployment resume checklist

- [x] Confirm Supabase organization and cost; create `deepend-mvp`. Vercel project setup remains pending.
- [x] Apply migration to the fresh Supabase project and verify permissions.
- [ ] Configure email OTP template, production sender and exact human origin.
- [ ] Deploy both Vercel surfaces with server secrets and the implementation branch as production source.
- [ ] Verify HTTPS/host routing, cron authorization and successful maintenance.
- [ ] Run authenticated hosted isolation, concurrent-write and delete/restore tests.
- [ ] Connect Muse A, Muse B and Instinct B through each owner's secure credential flow.
- [ ] Test hello/read-back, stable retries, reconnect and silent secondary behavior.
- [ ] Run ten scheduled closed-app canaries per agent; target nine within ten minutes, record all delays/failures. Include prompts that require an actual response, rather than treating intentionally quiet runs as failures.
- [ ] Verify B receives routine updates through only the chosen contact, including switching and ambiguous-send recovery.
- [ ] Record actual platform/version/account settings and any unmet release requirement.

## Explicit boundaries

The source cannot install proprietary Muse/Instinct grants or schedules from outside their accounts. Muse's current surrogate helper must be inspected and used inside Muse; its exact implementation is not guessed here. The OpenClaw client is optional, not a substitute for the required three-agent pilot. Platform-enforced private-tool isolation and silent notifications remain unverified. Selected public snapshots, automatic memory and external-action approvals remain v2 work.

The application is ready for deployment verification, not certified for real private use solely because automated tests pass. Review the deployment and restore gates before using sensitive content.
