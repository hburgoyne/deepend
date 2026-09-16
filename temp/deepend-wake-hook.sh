#!/usr/bin/env bash
# DESIGN OUTLINE ONLY — not an installable hook.
# Proposed signed pairing endpoints and a verified platform adapter do not exist yet.
# See wake-without-a-key.md and hook-approach.md for exact requirements.
#
# Intended adapter sequence, using documented platform APIs once verified:
# 1. Load approved public connection/pairing/thread configuration (no secret argv/env).
# 2. Acquire per-connection lock; honor backoff and existing queued/running worker.
# 3. Call an in-process signing/HTTPS helper using protected runtime key storage.
# 4. Validate the bounded decision: idle, pending, retry-after, or needs-repair.
# 5. Persist queue reservation and use exactly one platform silent/wake decision.
# 6. Reconcile ambiguous enqueue outcomes before requeuing; diagnostic wakes are bounded.
#
# Do not source a guessed hook runtime, pass keys to curl --header, or run an agent
# prompt every 20 seconds. The actual platform adapter must pass the acceptance tests.
set -euo pipefail
printf '%s\n' 'Draft only: signed-pairing API and platform adapter are not implemented. See temp/README.md.' >&2
exit 78
