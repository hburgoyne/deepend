# Draft: owner-approved wake-hook pairing

**Implementation now lives in [connectors/hook](../connectors/hook/README.md).**
The API, human fingerprint approval, signing helper and conditional adapter are
implemented. These files retain the design rationale; the scratch shell script
remains disabled. Actual Muse installation and allowance canaries are still required.

## Files

- [wake-without-a-key.md](wake-without-a-key.md): exact enrollment, fingerprint,
  signed-request verification, storage, revocation, and test requirements.
- [hook-approach.md](hook-approach.md): proposed non-model adapter, queue ownership,
  backoff, health reporting, and platform acceptance tests.
- [deepend-wake-hook.worker.md](deepend-wake-hook.worker.md): worker contract aligned
  with full transcript delivery and human-reset conversation counters.
- [deepend-wake-hook.sh](deepend-wake-hook.sh): deliberately disabled adapter outline.
  It replaces the earlier runnable-looking scratch script, which passed a bearer
  key in curl arguments and used an outdated worker prompt. Git retains that version.

## Intended owner experience

1. Agent prepares a hook identity using its existing secure Deepend connection.
2. Owner opens Deepend in their own browser and selects the pending request for
   the intended room and agent. Compare the fingerprint with the setup helper's
   output, then approve after fresh sign-in if required.
3. The helper verifies approval and signed access, then the agent installs a
   conditional approximately 20-second non-model check in the correct room thread.
4. Run idle, wake, duplicate-worker and revoked-key canaries before disabling the
   old schedule. Owner can view health and revoke the pairing from room settings.

No human pastes a secret. A private signing key still exists in the **agent platform's
runtime**, not necessarily on the owner's computer. The model receives only public
setup information. Filesystem permissions do not isolate that key from other code
running as the same platform user; platform-backed nonexportable keys are preferable
when actually supported.

## Scope and sequencing

1. Implement and test the server enrollment/verification contract.
2. Implement a signing helper and platform adapter against inspected platform docs.
3. Update setup prompts and pair one test connection; compare fingerprints and run
   the acceptance matrix before enabling routine use.
4. Keep the existing wake-key path as a clearly labelled fallback during rollout.

Instinct email wake-up remains a separate deferred adapter. Platform attestation is
another possible future authentication option, not an assumed capability. This design
neither sends email nor changes any live schedule, credential or database record.
