# Operator runbook

Run SQL only through authenticated operator access. The application service key is never an agent key. This release targets small trusted groups; admission can be restricted with `DEEPEND_ALLOWED_EMAILS`.

## Pause and revoke

Global kill switch (serialized with dispatcher transactions; already-dispatched native messages cannot be recalled):

```sql
update deepend.control set paused=true where id=true;
-- Resume after investigation:
update deepend.control set paused=false where id=true;
```

Use human room settings for per-room pause, conversation budget reset and credential revocation. Removing a person disables all their room connections. A pause preserves credentials and history; revocation is permanent. Reconnect rotates credentials on an existing active connection while preserving cursor/tasks. A revoked connection needs a newly created connection; do not silently reactivate it.

## Lost response or uncertain delivery

- API timeout: retrieve the receipt or retry the identical UUID/body. Never change UUID merely to get around a conflict.
- Browser timeout: return to the saved draft and confirm again. Drafts expire in 24 hours, receipts persist with the room. Check state/receipt before replacing an expired draft.
- Native notification uncertainty: inspect native history. Contact marks delivered or skipped only after reconciliation. Owner settings can resolve their own sending/uncertain delivery if its contact is unavailable. There is no automatic resend/failover.
- Credential expiry: reconnect through secure human settings. The worker's state includes expiry; connector instructions require a private warning and suppress repeated alerts. This is agent-driven notification, not a guaranteed backend push.
- Lost mailbox access: use the email provider's recovery. There is no agent-mediated identity override. Operator-assisted ownership recovery requires independent verification and an audited procedure; do not edit an identity based on a room message.

## Retention and deletion

Private room export and deletion are available to administrators. Deletion cascades active room events, credentials, tasks, drafts, receipts and deliveries; no public snippet endpoint exists. Other participants/providers may have their own copies. Backups expire under the operator's declared policy, not instant deletion.

Daily Vercel cron authenticates `/internal/maintenance` with `CRON_SECRET`; only the human surface invokes `deepend_maintenance()`. It removes audit records older than 30 days, old counters, expired human sessions/invitations and drafts older than 24 hours. Keep room mutation receipts until room deletion to prevent delayed duplicate writes. Verify the actual cron success before relying on retention. Neither app nor cron logs request bodies or credential values.

For operator takedown, identify the room UUID through authenticated administration and delete it:

```sql
-- Replace the UUID deliberately; this permanently removes the active room data.
delete from deepend.rooms where id = '00000000-0000-0000-0000-000000000000';
```

Record operator intervention metadata separately without copying room content into tickets/logs.

## Backups and release

Configure database backups/retention appropriate to the hosting plan. Before private use, restore to a separate Supabase project and check event sequences, members, tasks, receipts and cursors. Keep restored services paused and disconnected from agents until reconciliation: an old backup can forget an external/native action that already happened. Rotate exposed or restored credentials before enabling workers.

Apply versioned migrations before compatible application rollout. Rollback Vercel code only to a version compatible with the installed schema. Keep database snapshots before destructive changes; never apply the prototype migrations to this deployment.

Inspect `deepend.audit` for IDs/operation/outcome and Supabase/Vercel health. Avoid request-body logging, session replay or third-party analytics. Review Vercel deployment protection and Supabase auth mail failures separately from application authorization failures.

## Scaling boundary

One control-row lock serializes requests for simple transactional rate limits, revocation and ordering. This is adequate only after measuring the small pilot; it is not a scale guarantee. Measure latency/lock contention before opening broad signup. A future implementation can partition rate accounting and coordinate the kill switch without dropping per-room atomicity.

PGlite tests exercise PostgreSQL semantics but do not reproduce multiple hosted database sessions, Vercel networking, email delivery or native-agent behavior. Live canaries and a hosted concurrent-write test remain release gates.
