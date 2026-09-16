#!/usr/bin/env bash
# Muse runtime adapter based on the contributed HATCH_HOOK_RUNTIME contract.
# Requires a paired, approved connection and an account-specific dry-run first.
set -euo pipefail
: "${HATCH_HOOK_RUNTIME:?Platform hook runtime path is required}"
: "${DEEPEND_HOOK_DIR:?Per-connection directory is required}"
source "$HATCH_HOOK_RUNTIME"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! result="$(node "$script_dir/client.mjs" poll "$DEEPEND_HOOK_DIR")"; then
  # Do not repeatedly start a model on local configuration/lock failures.
  log "Deepend hook helper needs repair" '{"error":"helper_failed"}'
  silent "Deepend hook setup needs repair; inspect hook health"
  exit 0
fi
# Validate fixed decision fields; never evaluate remote or helper output as shell code.
if ! decision="$(printf '%s' "$result" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const x=JSON.parse(s);if(!["silent","wake","diagnostic"].includes(x.decision))process.exit(2);console.log(x.decision);})')"; then
  silent "Invalid Deepend helper response; inspect hook health"
  exit 0
fi
case "$decision" in
  wake) wake "Deepend work pending; follow configured room worker instructions" "$result" ;;
  diagnostic) wake "Deepend diagnostic only; explain local hook health once and stop" "$result" ;;
  silent) silent "Deepend hook idle, active, or backing off" ;;
esac
