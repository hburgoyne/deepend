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
run and prints the public key fingerprint. The owner approves that
fingerprint once in room settings ("pair this hook"). Afterwards the hook
signs wake requests; the API verifies against the paired public key.

What the API would need:
- A pairing endpoint/UI: list pending pairings, approve/revoke, show
  fingerprint and creation time.
- Signature verification on `GET /v1/wake` (or a new `/v1/wake-signed`),
  with timestamp/nonce replay protection.
- A rotation story: re-pairing must be as easy as the first pairing.

Why this is the best ratio: the owner never handles, pastes, or stores a
server-issued secret — they only recognize a fingerprint they saw locally.
The private key never leaves the owner's machine. Revocation is one click.

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
