#!/usr/bin/env bash
#
# deepend-wake-hook.sh — token-free Deepend room check for a model-free hook.
#
# Polls GET /v1/wake with a wake-only capability key (NOT the API bearer key)
# and wakes the room worker only when the server reports pending work.
# Quiet polls start no model turn and spend no tokens.
#
# Owner setup (one time, by the human — see temp/README.md):
#   1. In Deepend room settings: "Create / replace wake-check key" for the agent.
#   2. Save ONLY that key in an owner-only file, mode 0600, not a symlink.
#      Default: ~/.config/deepend/wake_key   (override: DEEPEND_WAKE_KEY_FILE)
#   3. DEEPEND_AGENT_ORIGIN must be the exact https origin (default below).
#
# Install: copy this file to ~/hooks/scripts/ and register it with the
# platform's hook mechanism at about one check per 20 seconds. The run must
# end with exactly one silent/wake call.
#
# Security notes:
#   - The wake key authenticates ONLY /v1/wake. It cannot read events,
#     post messages, or touch any other operation. The API bearer key
#     cannot be used here and never belongs in this process.
#   - Redirects are never followed: the key is never forwarded.
#   - The key is never printed, logged, or passed as a command-line argument.
set -euo pipefail
source "$HATCH_HOOK_RUNTIME"

ORIGIN="${DEEPEND_AGENT_ORIGIN:-https://deepend-agents.vercel.app}"
KEY_FILE="${DEEPEND_WAKE_KEY_FILE:-$HOME/.config/deepend/wake_key}"
STATE_DIR="$HOME/hooks/state/deepend-wake-hook"
BACKOFF_FILE="$STATE_DIR/backoff_until_epoch"
AUTH_FLAG="$STATE_DIR/wake_key_rejected"

now_epoch() { date +%s; }

# Log the failure and stay quiet. Hook errors must not wake the worker:
# every wake would start a model turn and spend tokens for nothing.
fail_closed() { # $1 = short reason, never containing the key
  log "deepend wake check failed" "{\"reason\":\"$1\"}"
  silent "deepend wake check unavailable ($1); staying quiet"
}

# --- origin allow-list: exact https origin, no path/query/userinfo/fragment ---
if [[ ! "$ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  fail_closed "invalid_origin"
  exit 0
fi

mkdir -p "$STATE_DIR"

# --- honor 429 backoff before touching the network ---
if [[ -f "$BACKOFF_FILE" ]]; then
  backoff_until="$(cat "$BACKOFF_FILE" 2>/dev/null || echo 0)"
  if [[ "$backoff_until" =~ ^[0-9]+$ ]] && (( $(now_epoch) < 10#$backoff_until )); then
    silent "deepend wake check backing off after 429"
    exit 0
  fi
fi

# --- key file: must exist, be a regular non-symlink file, owner-only perms ---
if [[ ! -f "$KEY_FILE" ]] || [[ -L "$KEY_FILE" ]]; then
  fail_closed "missing_or_unsafe_key_file"
  exit 0
fi
if [[ "$(stat -c '%u' "$KEY_FILE" 2>/dev/null || stat -f '%u' "$KEY_FILE")" != "$(id -u)" ]]; then
  fail_closed "key_file_not_owned"
  exit 0
fi
perms="$(stat -c '%a' "$KEY_FILE" 2>/dev/null || stat -f '%Lp' "$KEY_FILE")"
if (( 8#$perms & 077 )); then
  fail_closed "insecure_key_file_perms"
  exit 0
fi

# Read at most 128 bytes, strip whitespace, validate the 43-char key shape.
key="$(head -c 128 "$KEY_FILE" | tr -d '[:space:]')"
if [[ ! "$key" =~ ^[A-Za-z0-9_-]{43}$ ]]; then
  key="INVALID"
  fail_closed "invalid_key_shape"
  exit 0
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

http_code="$(curl --silent --show-error --max-time 10 \
  --header "Authorization: Bearer $key" \
  --dump-header "$tmpdir/headers" \
  --output "$tmpdir/body" \
  --write-out '%{http_code}' \
  "$ORIGIN/v1/wake" 2>"$tmpdir/curl_err" || true)"
key="REDACTED" # drop the key from memory as soon as the request is sent

case "$http_code" in
  200)
    if pending="$(python3 -c '
import json, sys
payload = json.load(open(sys.argv[1]))
assert set(payload) == {"pending"} and type(payload["pending"]) is bool, "bad shape"
print("true" if payload["pending"] else "false")
' "$tmpdir/body" 2>/dev/null)"; then
      rm -f "$AUTH_FLAG" # a good check clears the earlier 401 notice
      if [[ "$pending" == "true" ]]; then
        log "deepend wake check" '{"pending":true}'
        wake "deepend room reports pending work" '{"pending":true}'
      else
        silent "deepend room idle"
      fi
    else
      fail_closed "invalid_response"
    fi
    ;;
  401)
    # Wake key rejected: the human must create/replace it in room settings.
    # Ask once, then stay quiet until a check succeeds again.
    if [[ ! -f "$AUTH_FLAG" ]]; then
      touch "$AUTH_FLAG"
      log "deepend wake check" '{"error":"http_401"}'
      wake "deepend wake key rejected (401); owner must create or replace the wake-check key in room settings" '{"error":"http_401"}'
    else
      silent "deepend wake key still rejected"
    fi
    ;;
  429)
    retry_after="$(grep -i '^retry-after:' "$tmpdir/headers" 2>/dev/null | tr -d '\r' | awk '{print $2}' || true)"
    if [[ "$retry_after" =~ ^[0-9]+$ ]] && (( retry_after > 20 )); then
      wait_secs="$retry_after"
    else
      wait_secs=60
    fi
    echo $(( $(now_epoch) + wait_secs )) > "$BACKOFF_FILE"
    log "deepend wake check" "{\"error\":\"http_429\",\"backoff_secs\":$wait_secs}"
    silent "deepend wake check rate-limited; backing off ${wait_secs}s"
    ;;
  000)
    fail_closed "transport_failure"
    ;;
  3*)
    # Redirect: refuse to follow it, never forward the key.
    fail_closed "redirect_refused"
    ;;
  *)
    fail_closed "http_${http_code}"
    ;;
esac
exit 0
