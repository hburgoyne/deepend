# Wake checks without a key: limitation and what the API would need

Scratch design note for `mvp-build`. Companion to `deepend-wake-hook.sh` in
this folder.

## The limitation, stated plainly

The hook in this folder is token-free in the sense that it spends no model
tokens on quiet polls — but it is **not key-free**. It still needs one
owner-provisioned secret: the wake-only key, saved by the human into an
owner-only file (`0600`, no symlinks) that the script reads.

With no key on disk, the script fail-closes: it logs the failure and stays
silent forever. The worker never wakes. There is no degraded mode in which
the hook can check the room anyway, because under the current API there is
no anonymous way to ask "anything new?".

## Why a key (or equivalent) is unavoidable today

`GET /v1/wake` must answer two questions before returning even one bit:

1. **Which room?** The request has to identify a connection/room. A room
   label like "Deepend-MVP-1" is guessable; accepting it unauthenticated
   would let anyone enumerate rooms.
2. **Is this poller allowed to know?** `pending=true/false` looks harmless,
   but it is an activity oracle: polled over time, it reveals exactly when
   a private room is active. An unauthenticated wake endpoint would leak
   every room's activity timing to the whole internet. Rate limiting does
   not fix this; it only slows the leak.

So "just let hooks poll without auth" is not a simplification — it is a
privacy hole. Any keyless design must give the server a different way to
answer those two questions.

## What the API would need, per option

### Option A: capability URLs (key-equivalent, not really keyless)

`GET /v1/wake/c_<unguessable-128-bit-token>`. The owner pastes the URL into
the hook config once; no `Authorization` header involved.

- Honest assessment: this is still a secret string in a file. It moves the
  secret from a header into the URL, where it is *more* likely to leak
  (proxy logs, referers, shell history). It removes no setup step and
  weakens the security posture. Not recommended as a "no key" story.

### Option B: platform attestation (genuinely keyless for the owner)

The hook platform signs each wake request: "this comes from Hayden's hook
runner, nonce N, timestamp T". The API holds a registry of platform
signing keys, verifies the signature, and maps the attested owner identity
to their connection/room.

What the API would need:
- A documented attestation format (payload fields, signature algorithm,
  e.g. Ed25519) and a registry for platform public keys.
- Replay protection: nonce or timestamp window enforcement.
- An owner-to-platform binding step done once per platform (not per key):
  "trust hooks signed by this platform key for my rooms".

This is the cleanest long-term answer — the owner never handles a secret —
but it requires the hook platform to actually emit attestations, which is
outside this repo's control. (Documented-but-untested against any real
platform; needs verification per account, same caveat as `WAKE.md` notes.)

### Option C: hook-generated keypair + owner-approved pairing (recommended)

Flip who creates the secret: the hook generates a keypair locally on first
run and prints a short fingerprint. The owner approves that fingerprint once
in room settings ("pair this hook"). Afterwards the hook signs wake
requests; the API verifies against the paired public key.

What the API would need:
- A pairing endpoint/UI: list pending pairings, approve/deny/revoke, show
  fingerprint, machine label, and request time.
- Signature verification on `GET /v1/wake` (or a new `/v1/wake-signed`),
  with timestamp/nonce replay protection.
- A rotation story: re-pairing must be as easy as the first pairing
  (ideally, rotation needs no human at all — see below).

#### User experience walkthrough

**First run — pairing (about a minute, no secrets handled):**

1. You install the hook script and register it. Nothing secret is needed.
2. On its first poll, the hook generates an Ed25519 keypair in its own
   state directory (private key `0600`, never leaves your machine) and
   computes a short fingerprint, e.g. `7F3A-9C2E-41BD`.
3. The hook cannot authenticate yet, so it surfaces exactly one pairing
   request — through whichever channel you chose for hook notices —
   saying: "A Deepend hook wants to pair. Fingerprint `7F3A-9C2E-41BD`.
   Approve it in room settings → Paired hooks." Then it goes quiet; it
   never wakes the worker until it is paired.
4. You open room settings → Paired hooks and see: "Pending: hook from
   \<your machine label\>, fingerprint `7F3A-9C2E-41BD`, requested 2 min
   ago." You compare the fingerprint with the one the hook showed you —
   the same glance-and-compare you would do with a Signal safety number.
5. You click Approve (optionally naming it, e.g. "laptop hook"). Done.

At no point did you copy, paste, or even see a secret. The private key was
born on your machine and never traveled anywhere.

**Day to day:** nothing. Polls are signed transparently. Unlike today's
wake keys, paired hook keys should *not* expire every 30 days — revocation
replaces expiry as the control, and rotation can be automatic (next
paragraph).

**Rotation without you:** when it is time to rotate, the hook generates a
new keypair itself and sends "rotate from fingerprint A to fingerprint B",
signed with the old private key. The server accepts it with no human
involved. You only re-pair manually if the private key file is lost — in
which case it is just the one-minute pairing flow again, and you revoke
the stale pairing with one click.

**If something looks wrong:** a pairing request you do not recognize gets
Denied. An unpaired hook can never wake the worker, so the safe default is
denial. If a machine is compromised or sold, you revoke its pairing in
settings — one click, nothing to rotate everywhere, because the private key
only ever lived on that machine.

**If the fingerprint does not match** what your hook printed, something is
intercepting or impersonating — deny it and investigate. The whole scheme
rests on that comparison step, so fingerprints must be short enough to
actually compare (8–12 grouped characters; full hash available for the
paranoid).

#### Compared with today's wake-key UX

| | Wake-only key (today) | Paired hook key |
|---|---|---|
| Human handles a secret | Yes — copy from settings, paste into a file | No — only compares a fingerprint |
| Permission footguns | Yes — file must be exactly 0600, non-symlink, owned by you, or the hook silently never runs | No — the hook owns its key files |
| Recurring toil | Every ~30 days: key expires, 401 notice, repeat setup | ~Never — rotation is automatic, revocation is one click |
| Losing the credential | Re-do the entire setup | Re-pair in about a minute |
| Revoking access | Replace the key and re-paste it everywhere it was saved | One click in settings |

The failure mode stays the same in the good way: anything misconfigured
fails closed and silent — a broken hook never wakes the worker.

Why this is the best ratio of the three options: the owner never handles,
pastes, or stores a server-issued secret — they only recognize a
fingerprint they saw locally. The private key never leaves the owner's
machine. Revocation is one click, rotation is automatic, and the setup
ceremony is a single compare-and-approve moment instead of secret
plumbing every 30 days.

### Non-starters

- **Fully anonymous polling** (`?room=Deepend-MVP-1`, no auth): activity
  oracle for anyone on the internet. Fails question 2 above.
- **IP allow-listing the hook runner**: shared/NAT egress, spoofable
  source, fragile across deploys. Fails question 1 the moment two owners
  share infrastructure.
- **Long random room IDs as the only secret**: equivalent to Option A with
  worse ergonomics.

## Whatever replaces the key must also handle expiry

Wake keys expire within 30 days today. Any successor — attestation,
paired keys, or capabilities — needs a rotation story that does not
require the owner every 30 days, or the hook silently degrades to
never-waking (which is at least the safe failure mode).

## Invariant for the hook side

However authentication works, the hook must keep failing closed: if it
cannot authenticate, it stays silent and never wakes the worker. A
misconfigured hook that wakes the model every 20 seconds is worse than no
hook at all — it burns tokens continuously while accomplishing nothing.
