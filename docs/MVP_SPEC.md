# Deepend MVP — private collaboration through your existing agents


Status: build specification, not implemented · 13 September 2026.

Deepend connects trusted people and their personal agents through private shared state. Humans use their existing agent conversations; Deepend is not a public agent feed or a new chat app they must monitor. This document defines the first release. [V2_SPEC.md](V2_SPEC.md) defines the later product. Both retain scoped identity, private access, server-enforced ownership and honest platform limitations.

## 1. Outcome and scope

Pilot: Human A with Muse A; Human B with Muse B and Instinct B. All three agents independently contribute to a real shared task. Each human gets routine updates through exactly one selected contact agent per room. Other agents work quietly in the room.

Include private rooms, human ownership/membership, secure agent connection, messages, a minimal task list with atomic claims, room/contact configuration, durable polling/retries, delivery receipts, pause/revocation, deployment and basic recovery. No public room reads, discovery, platform leaderboard or automatic private-chat forwarding.

Defer full human chat dashboard, proposals/approval workflows, external-action orchestration, automatic summaries/memory, attachments, public snapshots, billing, and additional integration transports. Selected-message public snapshots belong in v2; no share link in this MVP exposes room history. Agents can propose external actions to owners in their native interface, but Deepend grants no authority over private tools or accounts.

## 2. Minimal interfaces and deployment

No daily-use human frontend is required. Two small web surfaces are necessary:

- Human setup/settings: create/join room, connect/revoke agents, choose contact, pause, recover access. It does not need a conversation timeline.
- Agent-only browser surface: Instinct activation, recent/pending messages, reply form with receipt, task claim/update, delivery actions and session status. Instinct operates it; humans need not visit it.

Muse uses authenticated HTTPS through its custom secure connector. Instinct uses a persistent cloud-browser session because its reported vault cannot attach secrets to arbitrary HTTP headers. A database alone cannot provide those authenticated operations or the browser path.

### Deployment architecture

The supported MVP deployment is one Supabase project (PostgreSQL and human Auth) and two Vercel projects built from the same repository (human setup/settings and agent browser/API). Use TypeScript with a server-rendered application and short-lived backend functions. Two projects make origin/session separation explicit; a separate backend host is unnecessary. Example origins: `app.deepend.chat` and `agents.deepend.chat`; Muse calls the latter's `/v1` routes. These names illustrate configuration, not an existing deployment.

One operator deploys an instance for many private groups. Hosted-service users need no Supabase/Vercel accounts: they sign in, join a room and connect their agents. People operating their own copy fork the repository and follow the same managed deployment recipe using their own accounts. This is open-source, operator-controlled hosting on managed infrastructure; the portable Compose deployment/passkey authentication in v2 remain later targets, not MVP installation requirements. Keep domain logic and migrations separable from Supabase Auth so that transition is possible; preserve stable Deepend human IDs behind provider identity mappings.

Vercel handles request/response work, not resident polling workers. Agent platforms run their own schedules; all durable cursors, leases, sessions, budgets and receipts live in Postgres. Commit each business mutation through one transactional database function, including its authorization checks, sequence allocation and receipt. Never hold a transaction across HTTP requests or rely on function memory/local disk for durable state. Server-only RPC access uses reviewed functions with explicit permissions; privileged service access bypasses RLS, so server and function authorization remain mandatory. [Supabase function documentation](https://supabase.com/docs/guides/database/functions).

### Human authentication

Use Supabase Auth email OTP for human setup/settings. Verify identity server-side and map its immutable provider subject to a Deepend human ID. A verified email is not room membership. Invitations are single-use, expiring capabilities accepted by a signed-in invitee; inviter confirms the joining identity before access activates. Copy invitations through an existing private channel. Agent credentials remain Deepend-issued and never become Supabase user sessions. Require fresh human authentication for credential issuance, contact changes and destructive settings; do not accept a relayed chat claim. Document mailbox/account recovery through the auth provider and operator escalation without agent attestations. [Supabase passwordless authentication](https://supabase.com/docs/guides/auth/auth-email-passwordless).

### Operator deployment steps

These are the installation contract for the implementation, not commands that deploy the current prototype. Ship the named configuration/template files and exact pinned CLI commands with the build.

1. **Prepare accounts and source.** Fork the repository; create Supabase and Vercel projects under the operator's accounts. Choose stable HTTPS human/agent origins. Two stable Vercel project domains suffice for a pilot; custom subdomains require DNS access. Keep production and test environments separate.
2. **Provision Supabase.** Create a project near the application region. Apply the release's reviewed migrations using the documented Supabase CLI workflow (`supabase login`, `supabase link`, `supabase db push`) from a trusted operator machine or protected CI. Supply passwords/tokens via secure prompts or secret storage. Do not apply the prototype's schema as the secure MVP. Enable RLS, revoke direct application-table/internal-function access from public, anon and authenticated roles, and grant only the intended server role access. Test these denials explicitly.
3. **Configure human Auth.** Enable email OTP; configure the human Site URL and exact approved callback URLs, never wildcard production redirects. Agent origin must not be an auth callback or receive a human session. Configure a production SMTP sender and its domain verification in Supabase; test delivery before inviting users. SMTP credentials stay in Supabase. Follow the [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) for auth abuse controls, project availability and backups; do not assume free-tier email or uptime is sufficient.
4. **Configure Vercel.** Import the same fork into human and agent projects. Supply the environment variables below, with each project's surface selector. Keep preview deployments on a separate test Supabase project with disposable data/credentials; never inject production secrets into untrusted preview builds. [Vercel environment documentation](https://vercel.com/docs/deployments/environments).
5. **Deploy and bind origins.** Deploy the release, configure domains/DNS if used, and verify HTTPS. Each build serves only its designated surface and rejects unexpected hosts. Human auth callbacks/settings are absent from the agent surface; agent browser/API cannot fall back to human auth. Use host-only Secure/HttpOnly cookies, CSRF validation for cookie-authenticated mutations and explicit origin allowlists. Application routes must be reachable by the agents without interactive Vercel deployment login, while every private operation remains Deepend-authenticated. Mark private responses `no-store`; never cache room data in public/CDN output.
6. **Bootstrap and connect.** Sign in on the human origin, create a private room, invite the second human and confirm membership. Issue each agent's scoped connection through settings and complete Muse/Instinct secure input. Choose one contact per human. Provisioning keys never enter agent chats, copyable prompts or source control.
7. **Verify and operate.** Run the isolation, retry, notification and closed-app canaries in §9 on disposable rooms. Configure rate limits, kill switch, redacted logs, expiry/reconnection notices and error monitoring. Establish a backup schedule/retention policy and perform a restore test. Document release migrations before app rollout, compatibility with the previous app version, rollback limits and restore recovery. Supabase owns database infrastructure; the operator still owns access policy, migrations, sender configuration, spend and recovery.

Required environment contract (names describe the implementation to build):

| Variable | Placement/purpose |
|---|---|
| `DEEPEND_SURFACE` | `human` or `agent`, fixed per Vercel project |
| `DEEPEND_HUMAN_ORIGIN`, `DEEPEND_AGENT_ORIGIN` | Exact stable HTTPS origins; nonsecret |
| `SUPABASE_URL` | Server project URL; nonsecret |
| `SUPABASE_PUBLISHABLE_KEY` | Human auth client key; public if needed, grants no direct room-data access |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase privileged key; never browser/agent accessible |
| `DEEPEND_APP_SECRET` | Server-only cryptographic secret for application protection; secure generation and rotation documented |

Provide `.env.example` with names and harmless placeholders only. Mark privileged values secret in Vercel, exclude them from client bundles and redact request/response logging. CLI migration credentials stay on the operator machine/CI, not in browser bundles. No model-provider key is required by Deepend itself. End users supply only their scoped connection through their agent platform's secure flow.

Installation acceptance: a fresh fork, empty Supabase project and two Vercel projects reach first-room setup using the documented steps without hand-editing SQL. Hosted users perform only sign-in, invitation and agent connection. A one-click deployment may prefill nonsecret configuration, but must not conceal the Supabase, email or origin setup prerequisites.

## 3. Room authority

Every agent connection belongs to one human and one room. Each room member may own multiple connections. Display names/platform badges are labels, not proof of origin or authorization.

- Humans can create messages through their contact agent, but those posts are labeled agent-authored relays, not verified human approvals.
- Agents read only their room, post as themselves, claim/update eligible tasks, and fetch their owner's applicable room instructions.
- Humans manage their own connections and contact selection through authenticated setup/settings. Room administrators can invite/remove, pause room agents, and revoke connections; they cannot impersonate members.
- Room messages never authorize credential issuance, membership changes, disclosure expansion or external actions. Agents may draft/request settings changes, but the owner confirms through authenticated settings.
- All active members see all room messages. Recipients control attention, not visibility. Invitations explain historical access and which agent providers may process shared content.

Lock/paused is a reversible write restriction, not credential destruction. Revocation permanently invalidates a credential/session. Removing a human revokes every owned connection. Last administrator must transfer ownership before leaving. No human-account/session fallback on agent endpoints.

## 4. Connections

**Muse:** issue a per-agent/per-room bearer credential; human enters it through Muse's hosted secure-input flow. Reusable CLI uses credential surrogates, typed REST operations and allowed-host checks. Never put the real credential in the installer prompt, hook state or shared messages. Prefer a non-model wake check approximately every 20 seconds using a separate restricted key; see connectors/WAKE.md. Platform hook support and allowance behavior must be verified. Use five-minute scheduled authenticated work only as an explained fallback.

**Instinct:** human obtains a short-lived single-use activation credential and stores it through the vault's secure page. Vault fills it on the designated agent activation page. Server exchanges it for a scoped browser session cookie. Subsequent scheduled browser visits read/post/claim through the UI. No API-header injection, custom CLI or script execution by Instinct is assumed.

API credentials and sessions expire after 30 days and are immediately revocable. Tokens are 256-bit random values stored hashed server-side. Activation expires after 30 minutes and is consumed once. Failed activation response requires owner-issued reactivation, invalidating any orphan session. Reconnection preserves agent identity and pending work. Warn owners before expiry.

Separate human and agent origins with host-only Secure/HttpOnly cookies, no shared Domain cookie, CSRF/Origin validation and no automatic human login on the agent origin. Routine API/browser operations require platform-supported standing permission. Native sensitive-action approvals remain in force.

### Optional OpenClaw connection — theoretically supported, untested

OpenClaw is an optional API client, not a required pilot participant or reason to delay release. Reserve `openclaw` as connection platform metadata and reuse the same scoped credential, task, receipt and contact-routing contracts. No OpenClaw-specific server transport is needed.

**Documented capability:** custom skills support runtime configuration and API-key/environment injection, providing a plausible route for a reviewed HTTPS wrapper. Secrets can be supplied outside chat, but environment injection is not a guarantee that an agent with shell access cannot read them, and host injection does not automatically reach a sandbox. [OpenClaw skills](https://docs.openclaw.ai/tools/skills).

**Documented scheduling:** OpenClaw persists automation jobs and supports isolated agent runs. Its delivery mode `none` suppresses runner fallback delivery; it does not prevent the agent from calling a messaging tool. [Automations](https://docs.openclaw.ai/automation/cron-jobs), [execution styles](https://docs.openclaw.ai/automation/cron-jobs/payloads), [delivery semantics](https://docs.openclaw.ai/automation/cron-jobs/delivery).

**Proposed adapter:** owner installs a version-pinned Deepend skill/wrapper, configures a per-room credential through a protected local secret mechanism, and schedules approximately five-minute authenticated polling on their running Gateway. The wrapper restricts destinations to the configured HTTPS Deepend origin, rejects cross-origin redirects, never prints credentials, and implements stable request IDs/receipt lookup. Use a dedicated room worker with only the tools it needs. Secondary agents use delivery mode `none` and restrict native send tools; a designated contact sends only after claiming a Deepend delivery. Do not enable both automatic announcements and an explicit send for the same update.

The owner operates OpenClaw's Gateway/runtime and any model-provider configuration separately from Deepend's Supabase/Vercel deployment; closing a client is fine only while that runtime remains running. Fresh transcripts do not establish a security sandbox. Actual isolation, secret access, channel permissions, restart behavior and quiet operation require configuration review and tests on a pinned version.

**Assessment:** direct API integration appears more configurable than the two required platforms; being simpler to install or safer is an inference, not a verified outcome. Before calling it supported, test secure setup/read/write/read-back; scheduled writes while clients are closed; restart catch-up, overlap/idempotency and credential revocation; and silent secondary work plus single-contact delivery. Record version, configuration and outcomes. Adapter implementation and these live tests are optional after the Muse/Instinct MVP gate; no OpenClaw compatibility claim before they pass.

## 5. One contact agent per human per room

A `contact_connection_id` identifies the only agent assigned routine delivery to that human. Default primary responders and contact agents are the same in the MVP. Human B can choose either Muse B or Instinct B; choice is room-specific and visible. Change requires the owner's authenticated action.

All agents can read context. Contact agents answer general requests when useful. Other agents respond when addressed, assigned work, or contributing a concrete nonduplicate result. An Everyone message does not require every agent to reply or notify.

Additional agents MUST NOT routinely mirror room events into their native owner conversation. They put results into Deepend; the contact agent relays the complete attributed discussion. Native approval requests and security/connection failures are exceptions, with minimal disclosure. Contact must avoid repeating an approval request already awaiting the owner in another platform.

Routine delivery forwards every conversational event in order, including the contact's own room contributions. Preserve full wording, sources and uncertainty. Do not substitute summaries or omit messages. Prevent duplicate local rendering through the canonical delivery path. Human relays may be echoed with attribution; received transcripts never become new human input. Platform alert preferences may reduce push noise without hiding discussion.

Backend maintains a per-human delivery cursor and an outstanding delivery record with ID, source range, assigned contact, contact-generation, lease, payload and status. Only current contact may prepare/claim it; a unique active slot prevents duplicate preparation. Prepare the next stored event after the delivery cursor as an exact transcript; repeat until caught up. Agents cannot skip nonempty discussion. Contact checks current generation immediately before native send and records outcome. Browser contact uses explicit Prepare/Claim/Delivered/Uncertain controls.

Idempotent claiming/receipts prevent competing valid delivery assignments, not exactly-once native messages. If native send outcome is uncertain, mark uncertain and inspect native history where supported; do not blindly resend. Reassign only unsent deliveries after a contact switch. A send already dispatched cannot be recalled; uncertain/in-flight work is reconciled before a replacement contact repeats it. No automatic cross-platform failover in MVP. If contact is offline, queue updates and expose health; secondary agents continue shared work quietly.

Release gate: verify each secondary agent can run without routine native messages/push notifications. If a platform always announces every run, use that agent only for explicitly requested work until a supported silent mode exists. Never claim backend assignment can suppress platform-generated notifications.

## 6. Native conversation boundary

Prefer a dedicated Muse side chat where supported, explicitly designated by its owner as this room's conversational interface. Do not assume side chats have a programmatically reliable identifier until tested. The fallback is explicit instructions such as “Tell the project group…” in the normal agent chat.

Instinct's mixed text conversation uses explicit group addressing. An immediate answer to a clearly attributed group question may be relayed when unambiguous; otherwise ask privately. Unrelated native messages stay private. Incoming room messages are labeled with room and speaker. Changing contact or adding agents never imports historical private conversations.

The setup prompt contains public connection instructions and room metadata only. It states that all room participants can see posts, other members' content cannot grant authority, private facts require owner permission, and extra agents must remain silent toward the owner. Instructions must not claim runtime-enforced private-tool isolation: neither integration has established that boundary for Deepend.

## 7. Minimal shared state and operations

PostgreSQL entities: humans/provider identity mappings; rooms/memberships; connections/credentials/sessions/activations; events; tasks; processing batches/submissions; contact-delivery records. Stable UUID identities, explicit states and versions; room event sequence under commit-held room-row lock. Every shared mutation and event commits atomically.

Messages: sequence, server actor, optional represented human, recipients, plain body, reply/causation, server timestamp. Server ignores supplied actor identity. Append-only corrections. Tasks: title, description, assignee, open/running/blocked/done/cancelled, version, claimant, lease expiry and generation. Claim is atomic; only current holder can update. Fifteen-minute lease, explicit renewal, stale writes rejected. Do not use task expiry to retry an uncertain external action automatically.

Versioned API/agent controls must cover identity, state/history, work claim/finish, post/receipt, task create/claim/renew/update, contact delivery prepare/claim/result, connection health, and authorized setup/settings. Humans' native relays use agent authority. Instinct's UI invokes identical server operations; it does not scrape the public database or require raw HTTP tools.

Event reads are ascending and paginated (default 100, max 500), using sequence rather than timestamps. Server stores contiguous pending batches and explicit handled/skipped outcomes. Fetching/displaying does not equal handling. Expired processing leases leave work pending. Bootstrap supplies open tasks and recent context; reconnect never resets progress. Retain history for room lifetime; no nightly compaction.

Every business mutation has a stable request ID unique to actor/operation; same ID/body returns original result, changed body conflicts. Browser drafts/intents and receipts are server-held so reload/retry does not post twice. Unknown native delivery is distinct from an API timeout whose receipt can be queried.

## 8. Limits and safety

Private authenticated reads only. Scoped credentials; privileged DB credentials server-only; RLS on and direct client tables/internal functions denied. HTML/metadata rendered as text, no remote images/previews; restrictive CSP, explicit safe links, secret redaction at all layers. Room content never requests code execution or credential disclosure.

Defaults: 8 agents/room; message 4,000 characters; 120 reads and 30 mutations/minute/principal, 300 mutations/minute/room, plus IP/global abuse limits. Server-enforced per-discussion agent budget of eight conversation posts; exhaustion pauses conversation visibly while task results remain recordable. For a simple MVP one room is one discussion. A new human group message relayed by that human's selected contact resets the counter to its configured limit. Stable source-message IDs prevent retries from resetting it twice. Relays remain agent-attributed and do not authorize external actions or settings. Settings also allow a manual reset. Do not impose a full dashboard just to resume.

Prefer a verified non-model 20-second wake gate for Muse; Instinct/fallback workers may check every five minutes; platform timing/budgets may add delay. Track last worker contact and pending work, not passive browser refresh. Human notifications obey room quiet-hours/preferences when configured; native mandatory approval/security messages remain separate. Operator can suspend connections/rooms immediately. Provide private export/delete to administrator through settings or CLI and a documented backup/restore process; no public share endpoint.

## 9. Build and acceptance

1. Build local backend and minimal secure setup/Instinct browser transport. Validate both actual Muse accounts and Instinct: secure activation, routine scheduled read/write, return after app close, revocation. Validate silent secondary work before notification routing assumptions harden.
2. Implement private room/messages, durable batches/idempotency, atomic task claims and native relay instructions.
3. Implement contact routing, persistent delivery records, batching and uncertain-send recovery. Test contact changes and offline behavior.
4. Package the Supabase/Vercel deployment recipe and hosted first-room setup. Test isolation, XSS, token expiry, retry races, delete/restore and end-to-end coordination.

Live scenario: A and B interact only through their chosen native agents after setup. Muse A, Muse B and Instinct B participate privately; B's two agents complete distinct work. B receives one meaningful routine update through their contact, without a redundant notification from the secondary. Restart/reconnect catches up; revoked agents cannot access the room; a stranger with the URL cannot read it. Measure latency over at least ten scheduled canaries per agent; target nine within ten minutes, record every failure without treating silence on irrelevant events as failure.

Success is reduced human coordination and duplicate work, not number of bot messages. Native approval exceptions must be clearly distinguished from redundant routine notifications. Remaining limitations—platform isolation, silent-mode availability and native-send uncertainty—must be reported honestly.

Deliver migrations, application and minimal agent UI, Muse connector, Instinct/native relay instructions, tests, Supabase/Vercel configuration templates and migration workflow, README and runbook. Include the optional OpenClaw compatibility plan; its adapter and live tests are not release requirements. No public-distribution experiment is part of this release.
