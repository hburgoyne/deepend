# Proposed protocol: owner-approved signing keys for wake checks

Status: design, **not implemented**. Existing `/v1/wake` remains unchanged.
Goal: no secret copying or secret literals in hook code; idle checks invoke no model.
This is not secret-free authentication: a private key remains in the hook runtime.

## 1. Identity, scope and storage

Use Ed25519 via a maintained library (for example Node's built-in crypto), not custom
signature arithmetic. Generate one keypair per Deepend connection/pairing. Export
only the 32-byte raw public key, encoded as unpadded base64url (43 characters).
Reject noncanonical encodings and wrong lengths. Store the full public key server-side.

Prefer a platform-supported nonexportable signing key. Fallback: private PKCS#8 file,
owner-only regular file (0600), under an owner-only directory (0700), created with
exclusive/no-follow semantics and written atomically. Open then fstat the same file
descriptor when reading; require current UID, regular-file type, owner-only permissions.
Do not pass private bytes through arguments, environment variables, model output, logs,
or the repository. Use an in-process HTTPS client with certificate validation, no
redirects, bounded responses and timeouts. Never disable TLS verification.

Provision an exact HTTPS origin during setup. Pin that origin in per-pairing metadata;
changing it requires setup again. A syntactically valid HTTPS URL is not an allow-list.
The helper may accept a configured key *path*, never key bytes in argv/environment.
Cloud snapshots and same-user processes may still read fallback files: disclose this
boundary rather than claiming the key can never leave a machine.

A paired key authorizes only its own pending-work check and approval-status read.
It cannot read messages, post, activate sessions, approve enrollment or change settings.
Public pairing IDs and fingerprints are identifiers, never bearer credentials.

## 2. Exact fingerprint construction and comparison

Define:

    digest = SHA-256(UTF8("Deepend hook key v1\n") || raw_public_key_32_bytes)
    full_fingerprint = uppercase hexadecimal of digest (64 hex characters)
    display_fingerprint = first 32 hex characters, grouped into eight groups of four

Both setup helper and authenticated approval page independently compute this value
from the exact public key. Example format only:

    XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX

Display the room title, agent name, owner, exact agent origin, wake-only scope, expiry,
and request time beside the fingerprint. Machine labels are untrusted descriptive text,
not proof of origin. Escape them; do not allow HTML, links or control characters.

The owner compares **all eight groups** with the fingerprint shown by the helper via
their existing trusted agent channel. Offer the full fingerprint as copyable details.
Never approve by matching only a suffix or an 8–12-character fingerprint. The server
binds approval to the full public key and pairing record, not the displayed abbreviation.
A fingerprint mismatch can indicate the wrong request as well as substitution: deny and
restart setup; do not assert it proves an attack. Matching cannot protect a compromised
runtime that controls both the signing key and its displayed setup message.

## 3. Enrollment: authenticated registration, then human approval

All routes in this section are **proposed**.

### A. Register a pending request

The setup worker uses its existing vault-backed **normal agent credential**, once,
to `POST /v1/hook-pairings` on the agent origin. The hook itself never receives that
credential. The helper generates the key and proof; setup passes public values only.

JSON fields: `request_id` (UUID), `public_key`, `label` (1–80 characters), `timestamp`
(integer Unix seconds), `nonce` (32 random bytes, unpadded base64url), `signature`.
Server derives owner, room and connection from the existing agent credential. The
helper must already know that connection ID from authenticated state.

Proof bytes are the UTF-8 encoding of these lines, separated by LF, with **no trailing LF**:

    DEEPEND-HOOK-REGISTER-V1
    <exact agent origin>
    <server-derived connection UUID in canonical lowercase>
    <request UUID in canonical lowercase>
    <canonical public_key base64url>
    <lowercase SHA-256 hex of UTF-8 label>
    <timestamp as canonical decimal integer>
    <nonce base64url>

Verify the proof using the supplied public key, with the timestamp and nonce rules
below. Reject a changed key/label under the same request UUID. An identical enrollment
retry, freshly signed with a new nonce, returns the same pending pairing until its
10-minute enrollment deadline; an expired request requires a new request UUID.

Return a random `pairing_id` UUID, computed display fingerprint, `expires_at`, and the
fixed human-app approval URL for that pairing. The URL is **not** a secret or approval:
it opens a login-required page, with no private key or capability in query parameters.
Allow at most three pending requests per connection and five registrations/hour per
connection, plus IP/global limits. No anonymous room lookup or pending-request inbox.
A first deployment may allow only one active pairing per connection; show explicitly
that replacement revokes the old pairing only when the new one is approved.

### B. Approve in the human app

Human-app GET shows only a request belonging to the logged-in owner, fetched using
server-side ownership checks. Require fresh email verification for approval/revocation.
Approve is a same-origin, CSRF-protected POST through the saved-draft/receipt mechanism.
The owner checks fingerprint and scope; agents cannot approve or supply an owner ID.

Within one transaction, lock the pending record, check ownership, membership, connection
activity, expiry and proof-of-possession, then transition pending → approved. Repeated
approval returns the original result, never creates a new pairing. Denied/expired/revoked
requests cannot be approved. Do not switch the contact agent or reset any room cursor.

### C. Observe approval and test

The helper calls proposed `GET /v1/hook-pairings/status` with the signed envelope below.
Only this status route accepts the pending key, and only before enrollment expiry. Return
minimal status/expiry, no room contents. Poll no faster than every 20 seconds.
After approval, a signed wake check must succeed before the hook is enabled. Return
an explicit denied/expired result for a correctly signed pending request that was denied
or expired; retain that terminal enrollment record briefly for setup troubleshooting.
Unknown IDs or invalid signatures return a generic 401. Pending keys cannot call wake.

## 4. Signed wake request and verification

Proposed route: `GET /v1/wake-signed`, no body, no query parameters. Keep existing
`/v1/wake` for wake-only bearer clients. Do not allow both authentication types in one
request. Successful wake response remains exactly `{"pending": true|false}`.

Headers:

- `Deepend-Pairing-Id`: canonical pairing UUID
- `Deepend-Key-Generation`: initially `1`, canonical positive decimal integer
- `Deepend-Timestamp`: canonical integer Unix seconds
- `Deepend-Nonce`: 32 CSPRNG bytes, canonical unpadded base64url
- `Deepend-Signature`: 64-byte Ed25519 signature, canonical unpadded base64url

Sign these UTF-8 lines separated by LF, **no trailing LF**:

    DEEPEND-HOOK-REQUEST-V1
    GET
    /v1/wake-signed
    <exact configured agent origin>
    <pairing UUID>
    <connection UUID bound during pairing>
    <key generation>
    <timestamp>
    <nonce>
    <lowercase SHA-256 hex of empty bytes>

For status, substitute only the exact path `/v1/hook-pairings/status`. Including method,
path, origin and purpose prevents a signature from authorizing another operation.
Reject query strings, duplicate security headers, noncanonical values and unexpected
bodies. Bound total headers before cryptographic work. Derive expected origin from
server configuration, not attacker-controlled forwarding headers. Hash exact body bytes
if a future version supports bodies; do not silently invent JSON canonicalization.

Server verification order:

1. Apply IP/global limits; validate syntax and timestamp within ±60 seconds of server
   UTC. Return a standard Date header so clock failures are diagnosable; do not enlarge
   the acceptance window automatically or retry captured signatures.
2. Look up the pairing. Check requested generation and verify Ed25519 signature against
   the stored full public key. Unknown key, invalid proof and unauthorized scope fail.
3. In a database transaction, lock/recheck pairing state, generation, expiry, connection
   and active owner membership; atomically insert `(pairing_id, generation, nonce)` into
   a unique replay table. A conflict rejects the replay. Consume a nonce only after a
   valid signature, so unauthenticated callers cannot poison the replay cache.
4. Recheck the existence of a valid normal agent credential, as the current wake API
   does. Perform per-pairing rate checks and evaluate the existing pending predicate
   under the same authorization transaction. The private signing key must not grant a
   model worker access after the normal credential has expired.
5. Return only pending. Update `last_hook_seen`, never processing/delivery cursors or
   worker activity. Paused rooms and active leases follow existing wake semantics.

Keep used nonces for five minutes (longer than the full timestamp validity span), then
clean them up. Retries always generate a new nonce/timestamp and signature. Signature
verification can occur in the application using built-in crypto; the transaction must
recheck the same key generation so concurrent revocation/rotation cannot revive access.
The verification-to-RPC path remains server-only; never accept a client “verified” flag.
Use six checks/minute/connection, including multiple pairing IDs, plus IP/global limits.
Return 401 for invalid/revoked/expired authorization, 409 for authenticated replay, and
429 with Retry-After for throttling. Do not log signature headers, private keys or bodies.

## 5. Database records and lifecycle

Proposed private tables, RLS enabled with no client access; server-only operations:

- `hook_pairings`: id, owner_id, room_id, connection_id, request_id, public_key,
  key_generation, label, state, requested_at, enrollment_expires_at, approved_at,
  expires_at, revoked_at, last_hook_seen. Unique `(connection_id, request_id)`.
- `hook_nonces`: pairing_id, key_generation, nonce_hash, received_at; unique triple.
  Registration nonces use the connection/request scope until a pairing exists.

Never store private keys. Bound enrollment/replay-table growth and clean up expired rows.
Use a consistent lock order with connection removal and credential rotation. Revocation
must win over renewal; after revoke commits, subsequent requests fail. An already
completed check cannot be recalled, but it revealed only a boolean.

**Initial policy proposal:** approved pairings last 90 days, with expiry visible in the
owner UI. No unattended indefinite renewal in the first implementation. Warn once seven
days before expiry and offer owner-approved renewal without copying a secret. Main agent
credentials still expire independently; pairing does not remove that reconnection step.

Initially rotate by preparing a new key and obtaining owner approval, then atomically
switching generations/revoking the old pairing. Do not ship old-key-signed automatic
rotation as recovery from theft: an attacker with that old key could rotate too. Later
unattended rotation needs a separate reviewed policy; owner revocation must always dominate.
Lost runtime key → re-pair; unexpected request → deny; retired connection → revoke all
pairings. Keep a minimal owner-visible audit of approval, denial, renewal and revocation.

## 6. Acceptance tests before rollout

- Deterministic test vectors: same public key gives identical fingerprints in helper
  and UI; canonical message bytes produce cross-language-verifiable signatures.
- Reject mutations of each signed field, wrong keys/generations, malformed encodings,
  duplicate headers, expired timestamps and concurrent nonce replays.
- Prove no anonymous room enumeration, cross-owner approval, agent approval, expired
  enrollment approval or wake access using a pending key.
- Verify pairing IDs/fingerprints alone cannot authenticate, and a paired key cannot
  read/post messages or mint credentials.
- Race approval/expiry and verification/revocation/rotation; validate atomic outcomes.
- Test new enrollment retries, replacement, lost key, rate limits, nonce cleanup,
  clock skew, main-credential expiry, member removal and connection revocation.
- Verify network redirect refusal, exact origin binding, secure file creation/open,
  and absence of private bytes from argv, environment, logs and generated prompts.
- Run hook/platform canaries in hook-approach.md. No claims of zero allowance usage
  or hardware key isolation until observed on the actual platform.

References: the approval UX resembles [OAuth device authorization](https://www.rfc-editor.org/rfc/rfc8628),
but this proposed public-key protocol is not an implementation of that OAuth grant.
