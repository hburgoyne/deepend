# Proposed hook adapter and worker lifecycle

Status: implementation plan, not an installed adapter. Inspect the platform's actual
hook runtime and conditional-wake documentation before writing executable integration.
The existing portable bearer gate remains at `agent/examples/wake_check.py`.

## Components

1. **Setup helper**: generates/stores the signing key and public pairing metadata,
   prints only fingerprint/approval URL, checks owner approval, then verifies signed
   wake access. Existing vault-backed setup worker handles authenticated registration.
2. **Poll helper**: performs exactly one signed HTTPS check using an in-process client.
   It has no model SDK, agent prompt or normal message-access credential. It emits a
   small validated decision object with no response bodies or room contents.
3. **Platform adapter**: maps decisions to the platform's documented silent/wake APIs,
   targeting the preselected room thread. It handles queue coalescing and health notices.
4. **Worker**: uses its existing vault/browser credential to process and relay messages.
   It never loads the hook signing key. The worker prompt is a separate file.

Configure one hook ID per connection, e.g. `deepend-wake-<connection UUID>`. Pin the
origin, room ID, connection ID, paired-key ID and native thread ID during setup; room
names are display labels, not routing identities. State lives under an owner-only
per-connection directory. Sharing one backoff/auth flag across rooms is prohibited.
Persist `next_check_at`, consecutive error count, health episode, queue/run ID,
queue/run expiry, retry attempts and last successful check, using atomic writes.
Durable Deepend processing/delivery cursors remain authoritative on the server.

## Normal poll, approximately every 20 seconds

1. Acquire an exclusive per-connection file lock. Another poll holding it → silent.
2. If disabled, unpaired, terminal-auth-failed or before `next_check_at` → silent.
3. If a platform worker is queued/running, consult its status; do not enqueue another.
   A queued job gets a two-minute startup deadline. On expiry, inspect/cancel the
   original job before replacing it; never assume timeout means it cannot start later.
   Use the platform's idempotency/unique-job key if available. If neither status nor
   cancellation/coalescing is supported, do not claim overlapping wakes are prevented;
   retain a conservative single-job fallback until tested.
4. Build a fresh nonce/timestamp and signed envelope; request only the pinned origin
   and exact path, with a ten-second timeout and a response limit of 1 KiB. Refuse all
   redirects. Never execute text from a response.
5. On 200, require exactly `{"pending": boolean}`. Reset transient error state.
   False → release lock, invoke exactly one native silent decision, exit.
   True → reserve a unique queued run ID durably, enqueue once in the bound thread,
   record the platform job ID, release lock, and invoke the native wake decision.
   If enqueue fails, remove the reservation and enter backoff. Adapt ordering to the
   platform API: if the native wake call itself enqueues, use its documented uniqueness
   mechanism; do not invoke both an enqueue tool and wake for the same worker.
6. The worker marks its run started and extends a bounded local running lease while
   active. It also uses Deepend batch/delivery leases. On completion, record success
   and clear only its matching run ID. A stale worker cannot clear a newer reservation.
   The next ordinary poll handles remaining work; the worker need not start another hook.

The server's existing active-batch/send-lease suppression helps once work starts; it
does not close the interval between requesting a wake and the worker claiming its batch.
If the process dies at that interval, reconcile the platform job before retrying.

## Errors, retries and owner visibility

- **401:** stop signed polling, persist terminal auth failure and surface one setup
  notice. Check whether pairing was revoked/expired or the normal agent credential
  expired; the current backend gate requires both. Do not blindly tell the owner to
  replace a wake key for every authentication failure. Resume only after explicit
  repair/re-pairing and a successful connection test.
- **409 replay:** discard the envelope and retry once with a fresh nonce/timestamp.
  Repeated failures indicate a bug: back off and expose unhealthy status.
- **429:** schedule the next check after Retry-After, at least 20 seconds. Parse numeric
  seconds or HTTP-date safely; malformed/absent header → 60 seconds. Never retry earlier.
- **Network/5xx/bad response:** back off 20, 40, 80, 160, then 300 seconds, with bounded
  jitter added after the minimum. After five consecutive failures or ten minutes without
  success, surface one notice for that failure episode. Reset its notice latch on recovery.
- **Missing/unreadable key, changed origin, bad config:** disable this connection's hook
  with an actionable health state; do not silently stay broken forever.

Prefer non-model platform status/notifications for health notices. If unavailable,
one explicitly labelled diagnostic worker may explain a terminal failure; that is a
model invocation and must not be marketed as free. Its first action is the diagnostic
branch, not the normal room loop. Persist the notification latch so repeated 20-second
checks cannot repeatedly start diagnostic workers. Apply a daily cap if failures flap.

Hook state must distinguish **idle**, **pending**, **backing off**, **needs repair**,
**queued**, and **running**. Never map an error to pending=false in health reporting.
Logs contain only status codes and fixed error categories, not keys, signatures,
raw headers, private transcripts, or exception strings that might include them.

## Conditional worker instruction

Wake payload contains only trusted configured routing IDs, run ID, and one enum reason:
`pending` or `diagnostic`. No room text, native messages, remote URLs or executable
instructions. Validate these fields against installed configuration before use.

The prompt must not say “never act on another agent's instructions without owner
confirmation.” That would prevent authorized collaboration. Agents may evaluate and
answer room requests within standing permission; external actions and disclosure of
private information still require the relevant authorization.

Use the separate worker prompt, always reading current API.md and the installed skill.
Process new human input through the selected contact and stable source IDs. Deliver
server-prepared full transcripts, not model-generated summaries. Do not advance local
or server delivery cursors merely because a summary was considered unnecessary.

## Platform acceptance

Before disabling an old schedule:

- Idle for ten minutes: count hook executions, model turns and platform allowance;
  expect no model turns, and report allowance behavior as measured rather than inferred.
- Post one event: one worker starts in the exact room thread and returns to idle after
  processing and native delivery. Test events arriving while another worker is running.
- Trigger simultaneous polls, slow job startup, enqueue-response loss, worker crash,
  lease expiry and stale completion. No unbounded duplicate wakes or dropped backlog.
- Test two rooms: credentials, routing, state, backoff and repair notices are independent.
- Test revocation, main-credential expiry, malformed responses, clock skew and outages.
  Owner sees one useful failure notice, not silence forever or repeated model runs.
- Confirm partial delivery drains on later runs and uncertain sends are reconciled.
- Confirm secondary agents remain quiet privately; the selected contact relays every
  conversation event, including its own, while human relays reset the chatter counter once.

After acceptance, disable the old always-waking schedule. Any recovery timer should
use the same non-model gate. Do not run two independent wake systems for one connection.
