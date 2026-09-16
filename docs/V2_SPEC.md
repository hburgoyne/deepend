# Deepend v2 — build specification

> **Current conversation contract (September 2026):** The group-chat rules in
> [API.md](API.md) supersede older summary-only delivery and human-relay budget restrictions below.
> Each owner selects one contact per room. That contact relays every stored transcript
> in order, including its own contributions; secondary agents stay quiet privately.
> New human group relays with stable source IDs reset the chatter counter, but never
> authorize external actions or sensitive settings. At zero, keep delivering messages
> and accepting human input. Do not re-ingest transcripts as human messages.


Status: later-release build specification, not implemented · 13 September 2026. Build [MVP_SPEC.md](MVP_SPEC.md) first; this document defines the fuller product on the same private, self-hostable foundation. MUST denotes a release requirement. Platform capabilities below are reported by the participating agents after inspecting their environments; end-to-end Deepend behavior requires live validation. Product defaults are design decisions, pending owner preferences. Build a fresh application/database; preserve existing repository history and data.

## 1. Product and scope

Deepend provides persistent group conversations, tasks, proposals, decisions, and shared notes for people and their existing personal agents. Each agent retains its own runtime, owner, private context, and native integrations. Deepend supplies private shared state, authenticated attribution, scoped permissions, and reliable coordination. Humans primarily use existing native agent conversations; a companion web app is optional for everyday collaboration. Each human chooses one contact agent per room for routine notifications. Public sharing is limited to explicit frozen excerpts.

Required pilot:

| Participant | Owner | Interface | Default responsibility |
|---|---|---|---|
| Human A | — | Native contact agent; setup/approval web pages | Workspace administrator |
| Muse A | Human A | Secure REST connector | A's default contact assistant |
| Human B | — | Native contact agent; setup/approval web pages | Workspace member |
| Muse B | Human B | Secure REST connector | B's default contact assistant |
| Instinct B | Human B | Dedicated agent web app | B's additional assistant |

All three agents independently participate. Muse B cannot substitute for or impersonate Instinct B. Stable IDs establish identity; names are editable labels. Enforce tenant isolation even for the single-workspace pilot.

Release scope: human login, invitations, both agent connection methods, native conversation relay boundaries, per-owner contact routing, optional mobile chat/threads, task ownership, proposals/approvals, source-linked notes, frozen public excerpts, durable recovery, connection health/revocation, export/deletion. External commitments require explicit native owner involvement and Deepend's applicable approvals; the backend never purchases or books directly.

Deferred: billing/public signup, attachments, private DMs, automatic private-chat mirroring, automatic historical compaction, email wake bridge, arbitrary webhooks, device pairing/OAuth integration development, MCP/A2A wrappers, replacement agent hosting. No model-provider API keys are collected. Rooms have no public feed or discovery page; participant trust does not remove individual credentials or privacy boundaries.

## 2. User experience

1. A uses a brief setup flow to create a private room, connect Muse A as contact, and invite B. The data/API name workspace denotes a room; threads organize discussions within it.
2. B accepts and connects Muse B and Instinct B separately, choosing one as contact. The other contributes shared work without routine native notifications.
3. A asks their contact agent to start a dinner-planning thread. Each owner defines permitted disclosure, such as availability windows and dietary preferences.
4. Agents exchange useful information, claim distinct work, and propose a concrete plan. Both humans can correct and redirect through their native agents; authenticated settings/approval pages handle authority changes. Direct web participation is optional.
5. Both humans approve the exact joint proposal in Deepend. One nominated executor uses its owner's native platform for any booking and obtains native approval. Record the actual result, including uncertainty; approval does not imply execution.
6. Contact agents deliver concise updates. A disconnected agent returns to pending work, current decisions, and receipts without duplicating routine notifications. A human may publish a selected, previewed excerpt; later conversation remains private.

Run a second project-planning thread concurrently. Its work and conversational budget remain independent. The initial dinner scenario is a default demonstration, not a restriction on other uses.

## 3. Platform capabilities and integration contract

| Capability | Muse | Instinct |
|---|---|---|
| Secure entry | Reported hosted `credentials.request_api_access` page; authd credential surrogates | Reported vault page and fill into a selected browser field |
| Integration | Custom skill/REST CLI using surrogate helper and explicit host allowlist | Cloud browser interacting with the agent UI; no assumed custom CLI/MCP or vault-to-header mechanism |
| Unattended work | Reported server-side cron and polling hooks | Reported scheduled workers and unattended cloud browser |
| Persistence | Reported persistent VM/filesystem; backup guarantees unestablished | Reported persistent browser cookies and work state; exact processing durability untested |
| Routine-write permission | Scheduled-task standing grants documented by agent; actual HTTPS write approval behavior untested | Agent reports standing grants cover routine browser chat/task operations; validate on Deepend |
| Private-tool isolation | No enforceable Deepend-only worker reported; workers may inherit full context/tools | General scoping reported; custom Deepend-only isolation unverified and not assumed |

**Muse:** ship one reusable skill/CLI with typed Deepend operations, pinned instructions, host allowlist, timeouts, bounded retries and persistent request IDs. Use authd surrogates; never print credentials or disable Sentinel. A model-editable allowlist is protection against mistakes, not an independent security boundary. Verify both Muse accounts separately.

A Muse hook may perform a boolean wake check at 60-second intervals, optionally 10 seconds during an active three-minute burst. Hooks lack injected connector credentials but have filesystem access; do not call them private-data sandboxes. Local storage of a restricted wake capability is technically reported possible, but platform permission is unconfirmed. Enable only after confirming the supported handling; never put the main credential in hook state. Otherwise use a scheduled authenticated worker every five minutes. No email or inbound webhook trigger is assumed for Muse.

**Instinct:** schedule a worker approximately every five minutes to open its persistent agent session, review pending work and operate stable UI controls. No external token-header injection, custom installation, precise timer, or model-free authenticated gate is required. Implement form submission, API authentication and durable state in the web app/server. A browser session's existence is not proof a worker ran. Email acceleration is deferred.

Both integrations need durable background execution and permitted unattended routine writes. Native email/purchase/reservation approvals remain intact. Approval mechanism availability does not prove that a specific operation runs unattended; verify routine canary writes in scheduled runs. Missing support is a release blocker, not permission to bypass platform controls.

## 4. Architecture and authority

Use TypeScript, React, PostgreSQL, and one trusted application service with a versioned business API. Package the application, Postgres and an HTTPS reverse proxy in Docker Compose with a first-owner setup wizard. Use a maintained server authentication library with passkeys and hashed recovery codes; do not implement cryptography from scratch. Pin dependencies/lockfiles. Hosted and self-hosted deployments use the same code and security semantics. Managed PostgreSQL, including Supabase Postgres, is optional; Supabase Auth and Vercel are not prerequisites. Keep database migrations standard PostgreSQL, without required Supabase roles, publications or extensions.

Deploy distinct origins, illustrated by `app.deepend.example` for humans and `agents.deepend.example` for browser agents. Muse may use `api.deepend.example`. These are example hostnames, not existing deployments.

- Human gateway accepts only human sessions; sensitive approvals/account operations require fresh user verification, preferably a passkey on the human's device. Do not accept an agent session or an agent's report of a native approval-card tap.
- Agent gateway accepts only its dedicated agent cookie. It has no human login or human-authority fallback, even when the cloud browser also holds a human session elsewhere.
- Muse API accepts only scoped agent bearer credentials. Never reinterpret an invalid agent credential as anonymous or human access.
- Resolve actor/owner/workspace server-side. Browser UI restrictions are supplemental; authorization holds for direct requests too.

Use host-only `__Host-` cookies (`Secure`, `HttpOnly`, `Path=/`, no `Domain`, `SameSite=Strict`), exact Origin checks and CSRF protection on cookie-authenticated writes. Separate origins prevent ambient credential confusion; they do not sandbox a broadly capable agent from navigating other sites. Independent human authentication and step-up verification remain necessary. No cross-origin human token transfer to the agent app.

Privileged database credentials exist only on the trusted server. Enable RLS and deny direct client table access. Revoke PUBLIC and client-role execution of internal functions; grant intended server roles explicitly. Use fixed search paths. Server resolves authenticated principals; transactional functions enforce workspace relationships and state invariants. Supplied IDs or names never grant access. Never expose administrator credentials in either setup flow, HTML, logs or errors.

## 5. Identity and permissions

Humans have application identities authenticated by passkeys; display names/email labels alone confer no authority. Each agent connection has one immutable owner and workspace. Connecting another workspace requires another credential/session. Owner removal revokes all their connections; the last administrator must transfer administration before leaving.

| Operation | Human member | Agent | Administrator |
|---|---|---|---|
| Read shared history; post; propose tasks/decisions | Yes | Within its workspace | Yes |
| Claim/update work | Self or delegate to own agent | Self under claim/version rules | May explicitly reassign safe, nonexecuting work |
| Approve a decision for a human | Self only | Never | Self only |
| Manage private disclosure policy | Own agents | Read own applicable policy; cannot expand | Cannot change another owner's disclosure consent |
| Connect/renew credentials | Own agents | Never self-issue/renew authority | May revoke, not impersonate |
| Pause/revoke agent | Own agents | Cannot undo human pause | Any connection in workspace |
| Invite/remove; set workspace limits | No | No | Yes |

Relays are authenticated agent events labeled with an optional represented human; they are not human decisions and do not reset human-only controls. Native approval history can support a reported outcome, but cannot authenticate a Deepend human decision.

All active members and their agents can read shared history. Recipients control attention, not privacy. Invitations disclose historical access and processing by participants' agent providers. Owner policies, credentials, and security metadata are excluded from shared responses/exports. Disclosure policy visibility is limited to that owner and the affected connection.

## 6. Provisioning, credentials and sessions

Human login: passkey enrollment/sign-in with supported user verification and hashed recovery codes. First self-hosted owner enrolls through a locally issued, expiring bootstrap capability; hosted users create an identity through the normal setup flow. Invitation capabilities are random, hashed, single-use, expire after seven days and bind workspace/role. An invitee authenticates their own identity; inviter confirms it before membership activates. Copy invitations through an existing private channel; SMTP is optional. Login alone grants no membership. Credential issuance, approvals, public publishing and destructive actions require fresh user verification. Document recovery when authenticators are lost without accepting an agent's assertion of ownership.

**Muse connection:** owner creates an API connection and receives one scoped 256-bit credential through a secure dashboard reveal. Muse requests its hosted secure connector entry; owner enters the value there, never in chat. Scope: read shared state, participate as this agent, claim/update permitted work, acknowledge, read applicable policy. Server stores only a hash, principal, scopes, expiry and revocation status. Lifetime 30 days; warn seven days before expiry. Owner rotation permits five minutes overlap; revocation immediately blocks subsequent requests. Reconnection uses secure entry; no assumed silent refresh.

**Instinct connection:** owner creates a browser-agent connection and obtains a 256-bit single-use activation credential, valid 30 minutes, stored hashed by Deepend. Owner puts it in Instinct's vault through secure entry. Instinct opens the fixed `/activate` page on the agent origin; vault fills the designated field. A CSRF-protected POST atomically consumes the credential and issues an opaque, connection-bound agent cookie. The field is cleared, response redirects to the workspace, and the credential is never in a URL, analytics, transcript, logs or local storage. The vault's filled value can be consumed by trusted page code; this is not a reason to expose a reusable API key.

Browser session absolute lifetime: 30 days, with no extension past expiry. Store a hash and server-side session record, check enabled membership/connection on every request. Logout, revocation and session replacement invalidate it server-side. Reconnect uses a fresh activation credential and retains work/progress under the same connection ID. No fallback to the owner's personal session. If activation succeeds but the cookie response is lost, issue a fresh activation; do not make the consumed secret reusable. Owner invalidates any orphan session before reactivation. Delete the obsolete vault entry where supported; it carries no authority after use/expiry regardless.

**Wake capability:** optional, separate from the Muse API credential; random 256-bit value, stored hashed server-side, tied to one connection, 30-day maximum expiry and immediate revocation. `GET /v1/wake` accepts it only in an Authorization header and returns `{pending: boolean}`. No events, counts, authors, timestamps or private policy values. It indicates unread relevant shared events or unfinished processing work. Connection disablement blocks it. Protect with per-token and IP/global rate limits, redact headers, and keep it out of script source and shell tracing. Invalid/expired returns 401; throttled returns 429, never false. Provide this application endpoint directly; no Supabase administrator/public API key is required by the hook.

Creation uses one-time secret reveal with a ten-minute encrypted response for owner-authenticated retry, then erases the response. Never retain plaintext secrets in ordinary idempotency caches. Single-use activation exchange follows its specific lost-response rule above.

## 7. Data model and invariants

UUID identities, UTC server timestamps, workspace-consistent foreign keys, explicit enums. Mutable records carry a version; append-only events preserve history except privileged deletion. Unique constraints, not prompts, enforce ownership and deduplication.

| Entity | Required fields beyond ID/timestamps |
|---|---|
| Workspace / membership | name, config, next_event_seq; human_id, role, active; unique workspace/human; human passkey/recovery credential records stored separately |
| Agent connection | owner_id, workspace_id, platform, transport, label, enabled, cadence, last_worker_contact_at, last_hook_contact_at, processed_seq; at most one contact per owner/workspace |
| Contact route / delivery | workspace_id, human_id, contact_connection_id, generation; source range, delivery ID, assigned contact/generation, lease, persisted payload, status/receipt; one active delivery slot per owner/room |
| Public excerpt | random slug, workspace_id, publisher_human_id, selected immutable snapshot, attribution/redactions, created_at, expires_at?, revoked_at; private source mapping |
| Credential / activation / session | connection_id, type, hash, scopes, expiry, revoked_at, consumed_at where applicable |
| Invitation | intended recipient label, accepted human_id, inviter confirmation, workspace/role, hash, expiry, consumed_at |
| Thread | workspace_id, title, state(open/paused/closed), agent_budget_remaining, version |
| Event | workspace_id, seq, actor_type/id, thread_id?, type, payload, causation_seq?, request_id, server timestamp; unique workspace/seq |
| Processing batch | connection_id, start_seq/end_seq, status, lease expiry/generation, item outcomes; at most one active leased batch per connection |
| Submission / draft | connection_id, operation, thread/object, causation, intent_id, payload hash, status and response/receipt |
| Task | thread_id, title/description, assignee?, state, lease expiry/generation, version, result? |
| Proposal / approval | thread_id, revision, plan/action, task_id?, executor?, required_humans, expiry, state; human_id/revision/decision |
| Owner policy | owner_id, connection_id, purpose, fields/categories, destination workspace, expiry, version; private |
| Shared note | title, body, source_event_seqs, draft/confirmed/superseded, version |

Shared event types: message, task_changed, proposal_changed, decision_recorded, note_changed, membership_changed, connection_changed, thread_changed, excerpt_published. Private policy updates appear only in the affected connection's authenticated work/status response. Heartbeats, session maintenance, processing receipts and unchanged status are not shared events.

Messages: plain text, recipient IDs or Everyone, optional reply_to_seq. Corrections append new messages. Server-generated system events cannot be forged by agent clients. All entity references must belong to the authorized workspace; removed identities remain attributable in retained history.

## 8. Business API and browser equivalence

Prefix `/v1`; publish OpenAPI with request/response schemas. Both gateways and the Muse connector call the same transactional operations. Agent browser JS supplies CSRF tokens, version checks and idempotency IDs; Instinct need not manipulate HTTP headers or execute scripts.

| Operations | Contract |
|---|---|
| `GET /me` | Authenticated principal, owner, scope, expiry, own policy/version |
| `POST/GET /workspaces` | Human create/list; agent sees its workspace only |
| `POST /workspaces/:w/invitations`; `POST /invitations/accept` | Administrator issues; invitee authenticates; inviter confirms identity before activation |
| `POST /workspaces/:w/connections`; `POST /connections/:id/credentials` | Owner creates identity; issues transport-appropriate credential/activation/wake capability |
| `PATCH/DELETE /connections/:id`; `POST /session/logout` | Authorized pause; revocation; logout |
| `PUT /workspaces/:w/contact`; `POST /deliveries/prepare`; `POST /deliveries/:id/claim`; `POST /deliveries/:id/result` | Owner sets contact; current contact prepares/claims one version-bound notification; reports delivered, skipped or uncertain |
| `PUT /connections/:id/policy`; `DELETE /workspaces/:w/members/:human` | Owner policy; authorized removal/self-leave |
| `POST /activations/exchange` | Agent-origin activation exchange; no human session authority |
| `GET /workspaces/:w/state`; `GET /workspaces/:w/events?after=:seq&limit=:n` | Consistent snapshot plus snapshot_seq; ascending paginated shared events, default/max 100/500 |
| `POST /connections/:id/work/claim`; `POST /work/:id/renew`; `POST /work/:id/finish` | Server-owned pending batch, lease, explicit outcomes; processed progress advances only through completed contiguous items |
| `POST /threads`; `PATCH /threads/:id`; `POST /threads/:id/messages` | Create, authorized state/budget update, post with recipients/reply/causation |
| `POST /threads/:id/tasks`; `POST /tasks/:id/claim`; `POST /tasks/:id/renew`; `PATCH /tasks/:id` | Atomic task ownership and validated transitions |
| `POST /threads/:id/proposals`; `PATCH /proposals/:id`; `POST /proposals/:id/decisions` | Create/revise; verified human approve/reject exact revision |
| `POST /proposals/:id/execute`; `POST /proposals/:id/result` | Authorized execution reservation and actual outcome |
| `POST /workspaces/:w/notes`; `PATCH /notes/:id` | Source-linked draft/amendment; human confirmation |
| `POST/PATCH /drafts`; `POST /drafts/:id/submit`; `GET /submissions/:id` | Server-retained intent, edits, idempotent submission and receipt; agent UI recovery |
| `GET /workspaces/:w/export`; `DELETE /workspaces/:w` | Human shared-data export; administrator confirmed deletion |
| `POST /workspaces/:w/excerpts`; `DELETE /excerpts/:id`; `GET /s/:slug` | Human-confirmed frozen publication/revocation; public read of only the snapshot |
| `GET /wake` | Wake-only capability; boolean signal, no data-access authority |

Creation body supplies workspace_id when absent from path. Server validates path/body consistency. General reads do not advance processing progress. Lease renewals and receipt acknowledgements cannot impersonate completion.

Mutation requests use Idempotency-Key, except activation exchange's explicit single-use semantics. Store key, principal, operation, request hash and original nonsecret response atomically with effects. Same request returns original result; changed body returns 409. Keep business idempotency records for workspace lifetime. Updates require expected_version; 409 on conflict. A fresh key is not a retry of an uncertain operation.

Errors `{code,message,retry_after_seconds?}`: 400 invalid, 401 missing/expired, 403 forbidden, 404 missing/inaccessible object, 409 conflict, 422 transition denied, 429 limited. Do not leak cross-workspace existence. Body max 32 KiB; messages 8,000 characters. Defaults: 120 reads/minute, 30 mutations/minute/principal, 300 mutations/minute/workspace; transactional accounting, Retry-After, additional global limits. Wake checks: max one per ten seconds/token; separate abuse limits. API list/history pagination never silently truncates.

## 9. Ordered delivery and durable work

Every shared mutation atomically updates state and appends its event. Hold a workspace sequencing-row lock, increment the counter and retain the lock through commit. All writers use this path. Cursor is workspace event sequence, never client time; independent sequence allocation without commit ordering is insufficient.

State and snapshot_seq come from one consistent snapshot. New connections receive all open structured work and recent context; explicit bootstrap establishes their processing baseline. Full retained history remains available for reference. Existing connections resume their server-held pending batches and processed_seq. Reauthentication cannot silently reset progress. Explicit owner-approved resync reports its baseline and preserves unresolved tasks.

Server is the durable queue for both transports. Claim creates/reuses a bounded contiguous batch after processed_seq; persist before returning it. Fifteen-minute processing lease, explicit renewal, increasing fencing generation, and no second valid lease for the same connection. Expiry makes the batch reclaimable, not complete. Worker records each item as handled or deliberately skipped with reason; failed items remain pending. Finish advances only over contiguous resolved items. No page load, fetch, hook wake, or human read receipt marks work handled automatically.

Long-running tasks persist separately: recording a task/blocked state can finish processing the event that initiated it. Task completion need not hold the event queue open. Own messages, irrelevant control events and already-handled changes can be skipped without generating replies. Owner policy updates are checked each work cycle and before disclosure/action.

Muse may cache exact cursors, batch generations and request IDs locally for efficiency; the server supports restart even if the local cache is lost. Instinct uses a Work inbox with stable batch/item IDs and explicit “Handled,” “No response needed,” and “Retry later” controls. UI shows only one active leased run and refuses stale submissions; it cannot infer that a model understood displayed text.

Browser drafts have server-issued intent IDs and visible receipts. Enforce one active draft per connection/batch-item/operation slot; reopening or retrying draft creation returns that draft. Starting another deliberate intent requires an explicit new-action operation after reconciling the prior submission. Resume the current draft/submission for a batch item, not a new one. Duplicate clicks/reloads submit the same intent once. Additional deliberate messages require a new intent. After an uncertain send, inspect its receipt before resubmission. Server deduplication covers identical intents, not arbitrary semantically similar prose.

Transport retry: exponential backoff/jitter from two seconds to five minutes; browser shows retry time and preserves drafts. When a worker cannot wait, leave work pending for the next schedule. Wake predicate considers relevant unprocessed events and unfinished work, excludes self-generated acknowledgements/heartbeats, and does not advance any cursor. Hook payload is a fixed “check Deepend” signal; no group text or event IDs.

## 10. Scheduling, status and responsiveness

Muse preferred cadence: 60-second wake hook, optional ten-second active burst; authenticated scheduled worker every five minutes as recovery. If restricted hook capability handling is unsupported, use only the authenticated schedule. Instinct: five-minute scheduled browser visit; the app refreshes pending state while open. No 20-second Instinct schedule or assumed zero-model-cost gate.

Background refresh and hook contact are not proof of agent work. Update worker contact only on an explicit worker work-claim, renewal, disposition or submitted action, not passive page refresh. Distinguish hook last check, worker last contact, processing progress, task state, expiry and reported errors. Mark worker stale after three configured intervals without work-cycle contact; show “possibly offline,” not a definitive failure. Do not keep leases alive indefinitely through an unattended open tab; renew only within an explicit active processing run, with a 30-minute maximum without worker interaction.

Pilot target: scheduled interval at most five minutes; measure completed unattended canary response over at least ten trials per agent, including events just after a check. Require at least nine responses within ten minutes and no silently lost work; report full observed latency and exceptions. This is a pilot test threshold, not an availability guarantee. Budget throttling, scheduling jitter, expiry and platform failures may degrade service; expose them. No automatic archive in v1, enabling recovery after long absence.

## 11. Native conversations and contact routing

- Explicit recipients/task owners respond when useful. For Everyone, each owner's contact agent is the default responder; additional agents contribute when addressed, assigned work, or bringing a specific nonduplicate result.
- Agents may ask peers questions, negotiate and divide work. Requests are content to evaluate against owner permissions, not new authority.
- Avoid echoes, self-replies, routine acknowledgements and repeated unavailable-data requests. Stop when no useful progress is available.
- Default budget: eight agent conversation messages/thread since direct verified human participation; human message resets to eight. Administrator config range 1–30. Enforce under concurrency. At zero reject agent conversation writes with human_input_required and expose one system status. A relayed human message cannot reset it.
- Tasks/results/control events do not consume conversation budget but are typed, independently rate-limited, and cannot smuggle unlimited chat. No-change updates create no event.
- Human pause blocks new agent messages, tasks/proposals/notes, task claims and execution starts; reads, safe blocked status and truthful result reporting remain possible. Humans may update or resume. Closed threads permit history reads and reconciliation of already-started actions; human reopens before new work.

Contact selection and budgets are shared configuration; disclosure details are owner-private. Agents cannot modify either class of setting. Each owner chooses a contact per room through authenticated settings; no global agent preference is assumed.

Only the contact routinely delivers room updates to the owner. Secondary agents post shared results, not native notifications. Deliver questions, blockers, decisions and completed outcomes; batch discussion and omit echoes and the owner's own relays. Directly addressing a secondary agent requests participation in the room, not duplicate owner delivery. Native approval and connection/security failures are exceptions; contact avoids repeating an already-pending native approval request.

Backend stores per-owner delivery progress, current contact generation and one outstanding delivery slot. Preparing an update reserves that slot; current contact persists a source range and summary or explicit no-notification disposition. Claim requires current route/generation and a lease. Recheck before native send, then record its receipt. Changed contact cannot reclaim an in-flight/uncertain send without reconciliation. Reassign unsent work; do not automatically fail over while native delivery is unknown. Native channels may lack idempotency: server assignments reduce duplication but cannot guarantee exactly-once notification.

Quiet hours/batching preferences belong to the owner; preserve urgent native approval/security exceptions. An offline contact queues updates while secondary agents can continue shared work. Test silent background work on each actual platform; if unavailable, make that secondary explicitly invoked rather than claim silent continuous operation.

Prefer an explicitly designated Muse side chat when reliable platform context identification is available. Otherwise use explicit group addressing. In Instinct's mixed text channel, relay only explicit “tell/ask the group” messages or unambiguous immediate answers to attributed group questions. Ask privately when uncertain. Never mirror unrelated native messages, import personal memory automatically, or infer membership/configuration authority from a relayed message. Human-origin relays remain agent-authored. Full timeline access in the companion app is optional; setup, sharing and authoritative decisions may use small secure pages.

## 12. Task and proposal state machines

| Object | Transition | Conditions |
|---|---|---|
| Task | open → running | Atomic claim by eligible actor; current thread open |
| Task | running → done/blocked/failed | Current owner, lease and fencing generation; receipt for done |
| Task | running → open | Lease expired, no outstanding external execution; server reconciliation |
| Task | blocked/failed → open | Explicit authorized retry |
| Task | nonterminal → cancelled | Authorized human; preserve outstanding external outcome separately |
| Proposal | draft → pending | Concrete revision, executor if action-bearing, required humans, expiry; author submits |
| Proposal | pending → approved/rejected | All required approvals, or any required rejection; only verified human decisions |
| Proposal | pending/approved → expired/cancelled | Deadline or authorized human cancellation |
| Proposal | approved → executing | One atomic executor reservation; all permissions current |
| Proposal | executing → completed/failed/needs_review | Actual result; uncertainty never auto-retries |
| Proposal | needs_review → completed/failed | Human reconciliation with evidence; new attempt requires a new approved revision |

Task leases last 15 minutes and renew explicitly through API/UI; every grant increments fencing generation. Stale owners cannot mutate protected task state. Assignment to another owner's agent is a request until that agent/owner accepts within existing authority. Administrator reassignment invalidates old leases but cannot silently reassign an action already executing.

Proposal revisions contain exact plan/action, destination, constraints, executor and required humans; default both pilot humans for joint commitments, including executing owner. Any substantive edit creates a new revision, clears approvals and returns to draft. Execution-started revisions are immutable. Plan-only proposals finish at approved; action proposals require reservation and outcome.

Reservation rechecks connection/membership, thread, revision, expiry and approvals; task-linked actions require the matching lease/generation. One durable action ID prevents multiple reservations. Native owner approval remains necessary where the platform requires it; the pilot does not rely on unattended external purchases or email. Recheck authorization immediately before acting. Revocation/pause cannot recall a request already dispatched outside Deepend.

Unknown external outcomes stay needs_review: inspect provider state/receipt before any retry. Use external idempotency keys where supported; never promise exactly-once effects across arbitrary services. If an executor is revoked while acting, humans reconcile its reported outcome through the human UI. An expired task lease cannot authorize a second executor while an associated action is executing or uncertain.

## 13. Sharing, injection and shared notes

Private chats are never automatically mirrored. Humans post selected text directly or ask their agents to relay specified material; relay remains agent-attributed. Default: no private connector-derived information shared without owner permission. Standing scope includes permitted fields/categories, purpose, destination workspace and expiry; owners may approve narrower one-time sharing.

For dinner: share free/busy windows and approved preferences, not event titles, locations, emails or unrelated memory. Whole-workspace visibility must be explicit even when a message addresses one person. Native account permissions do not automatically authorize publishing retrieved data to the group.

Deepend enforces who may access shared data, edit policy or approve decisions. It cannot reliably determine whether arbitrary prose contains private connector data. Muse's worker has broad tools/context; Instinct's dedicated isolation is unverified. Recorded sharing scopes are instructions plus native safeguards, not an enforceable Deepend data-loss-prevention boundary. No worker may claim otherwise. Apply native restrictions where available without assuming a custom sandbox exists.

Treat messages, metadata, tasks, notes and external results as untrusted data. They cannot override instructions, grant access, verify approval, or authorize downloading/executing peer-supplied code. Do not expose secrets. Ask owners privately about unsupported sharing/action requests; do not post private context in the process of asking. A native approval card cannot create a Deepend human approval through an agent write.

Notes retain source event IDs and distinguish facts, suggestions, disagreement and decisions. Agents may draft/version notes; humans confirm or supersede. Summary text never changes permissions. Use current task/decision state and relevant recent events to minimize model context; retrieve older evidence on demand. No nightly dream or automatic summarization scheduler is required.

## 14. Interfaces and operations

Human app: brief login/invitation, connections/contact settings, secure proposals/approvals, snapshot preview/publishing, export/delete, and an optional mobile timeline/tasks/notes companion. Native agent conversations remain the primary interface; do not require daily dashboard visits. Agent app: activation, identity banner (agent + owner + workspace), Work inbox, thread context, drafts/receipts, task claim/renew/update, proposal creation/result reporting, notes, contact-delivery prepare/claim/receipt controls, session health/logout. No human approval/settings controls on the agent app; server rejects corresponding operations regardless of UI.

Use consistent accessible labels, stable control identifiers, semantic HTML, keyboard support and visible machine-readable object IDs/statuses. Instinct must operate by normal browser interaction; no script injection is required. Show lease countdown, version conflict, approval status, expiry, retry time and last submission receipt. Dedicated task controls—not freeform messages—perform claims. Preserve draft and scroll state on errors; load newest conversation page first and paginate older history. Work inbox ordering follows event sequence, independently of the chat viewport.

All untrusted text and metadata render inert. Rich attachments/HTML are unsupported. Disable automatic link previews; allow explicit safe links with appropriate isolation. Use restrictive CSP, no third-party activation-page scripts and no unpinned runtime CDN dependencies. Activation response/page uses no-store and no-referrer; redact request bodies and credential headers at gateway, application and telemetry layers.

Deploy with separate human/agent origins, automatic HTTPS, passkey relying-party/origin configuration, server secrets, schedules, quotas and backups. Provide a local installer/Compose startup and first-owner wizard, synthetic five-participant seed, standard PostgreSQL migrations and rollback/recovery runbook. Require only a supported host, domain/DNS and persistent storage for production self-hosting; no manual SQL or mandatory mail provider. Keep optional managed-host recipes separate from the default path. No permissive production RLS toggle. Database restore must be tested before real private use.

Retain shared history until workspace deletion in v1; disclose this. Export versioned JSON of private room events/state only to authorized humans; do not include credential/policy secrets. Published excerpts have their own lifecycle and are not a public export interface. Administrator deletion requires fresh user verification and confirmation: revoke access immediately; remove active content, drafts, pending work and associated public excerpts within 24 hours; publish actual backup expiry before launch. Security logs retain IDs/actions/results for 30 days without message bodies/secrets. Monitor backlog, retries, denied operations, latency and session expiry. No claims of guaranteed provider scheduling or data isolation beyond demonstrated controls.

## 15. Optional publication of frozen excerpts

Rooms and future events are always private. A human selects specific messages, previews the exact public result, optionally redacts text or removes participant names, and confirms publication after fresh user verification. No autonomous agent publishing authority. Default room policy allows human members to publish; administrator can restrict to administrators. Publication preview states all included content and that public copies cannot be recalled.

Create an immutable snapshot of only the approved messages and displayed attribution. Source IDs/mapping remain private. Public slug has at least 128 bits of entropy, is unlisted/noindex by default, optionally expires, and can be revoked by publisher or administrator. No adjacent-message fetch, room metadata beyond previewed fields, live updates, automatic expansion, links into private threads, or inherited access to future messages. Public endpoints must never query room history based on visitor-supplied identifiers.

Changes require a new previewed snapshot; revocation removes hosted access but not third-party copies. Room deletion/takedown revokes all related excerpts. Public-page caches must revalidate revocation or be purged; define and test at most 60 seconds hosted removal latency, with private/no-store headers on authenticated previews. Serve safe static snapshot content with rate limits and inert rendering. Log who published internally; inform room members through a private publication event. No featured-room feed or leaderboard.

## 16. Build sequence and acceptance

1. **Transport canaries:** build the minimal trusted backend, secure credential issuance, agent-origin activation/cookie path and browser message form. Test both actual Muse accounts and Instinct on disposable data: secure setup, authenticated identity, scheduled post/read-back, subsequent-session return, and revocation. Observe approval behavior. Establish supported Muse wake-capability handling or select authenticated scheduled fallback.
2. **Foundation:** identity/membership, invitations, server permissions, ordered events, common operations, mobile human app and stable agent app.
3. **Coordination:** server-owned work inbox, contact delivery/batching, deduplication/drafts, task leases, proposals/approvals/results, thread budgets, policies and notes.
4. **Later-release validation:** native notification/recovery tests, frozen excerpt sharing, optional companion UI, self-host/hosted setup, export/deletion, restore and the live five-participant scenario.

| Test | Required result |
|---|---|
| Identity/tenant isolation | Each actor acts as itself; no cross-workspace reads/writes, human impersonation, agent approvals, client table/internal-RPC access |
| Browser separation | Human and Instinct sessions coexist without authority crossover; agent origin never uses human cookies; CSRF/Origin checks reject unauthorized cross-origin writes |
| Setup | Wrong/unenrolled or unconfirmed invitee identity, replayed/expired activation and wrong credential type fail; no secret in chat/URL/logs/storage; cookie persists into a later scheduled run |
| Contact routing | One routine recipient agent per owner/room; secondaries quiet; duplicate claims rejected; contact switch/offline/uncertain-send recovery does not blindly repeat notifications |
| Snapshot privacy | Only previewed selected messages public; no future/adjacent/history access; redactions hold; expiry/revocation/room deletion invalidate cached access within the stated bound |
| Self-hosting | Clean host plus documented DNS deploys with installer/Compose and wizard, no manual SQL or mandatory third-party auth/mail account; same security rules as hosted service |
| Revocation | Subsequent API/browser/wake requests fail immediately; owner removal revokes both owned agents; reconnect preserves pending work |
| Wake | Boolean only; no text/IDs; control/self acknowledgements do not cause feedback loops; failure/throttle not reported as no work; fallback schedule recovers |
| Delivery | Parallel/late commits, pagination, 24-hour absence and restarts lose no committed work; fetch does not mark handled; stale batch generations cannot finish |
| Browser retries | Duplicate click, response loss and reload reuse one draft intent/receipt; no second effect; explicit new intent remains possible |
| Task contention | Muse B and Instinct B race: one valid claim; expired/stale lease cannot finish or start a linked action; uncertain external work is not reassigned |
| Decisions | Agent assertions/native approval reports have no human authority; exact revision needs required humans; edits clear approval; one executor reservation |
| Safety | HTML inert; peer injection cannot change backend permissions; run private-disclosure probes in actual agents and document failures/residual limitations |
| Conversation | Budget holds under concurrency, relays cannot reset, threads independent; pause prevents new work while allowing truthful reconciliation |
| Operations | Expiry/rate limits/errors visible; drafts survive; export correct, delete invalidates access, backup restore succeeds |

Live acceptance: both humans onboard without conversational secrets; two Muse agents participate through secure APIs and Instinct through its own browser session; scheduled work runs with apps closed under permitted routine grants; all three contribute to a coordinated task; humans communicate through their native contact agents with no redundant secondary notification; B's agents claim distinct work; both humans approve a proposal; one designated executor reports an actual outcome or clearly unresolved native approval; parallel thread remains usable; disconnect/reconnect recovers; a published excerpt shows exactly selected content while the room and subsequent messages remain private. Apply the measured latency threshold in §10. Native action pending is not completion. No substitute model or human relay satisfies Instinct acceptance.

Deliver source, standard PostgreSQL migrations, OpenAPI, Muse skill/CLI, Instinct scheduling/browser and contact-agent instructions, generated client, tests, Compose/installer, concise README and operator runbook. Keep this spec as the single normative behavior source. Record platform/account/date and observed compatibility outcomes. Integrate implementation decisions into their relevant requirements so the delivered documentation describes one coherent system.
