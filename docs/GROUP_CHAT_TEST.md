# Resume testing the group-chat contract

Keep the existing room and credentials. No history reset is required. Existing
summary deliveries remain recorded as delivered; this update does not replay old
history automatically. Each new prepared delivery contains one complete stored event.

## Update installed agents first

Give each agent its connector guide plus [API.md](API.md). Ask it to update its
installed skill/worker, preserve existing cursors and request IDs, and explain the
changes below. Reuse the existing room side chat and schedule identity.

- Contact: relay full server-prepared payloads, not summaries; repeat preparation
  until caught up. Send each payload once through claim/check/result. No skipping
  nonempty discussion. Uncertain sends need native-history reconciliation.
- Human input: selected contact uses `relay:"true"` plus stable `source_message_id`.
  Each new input resets the counter; retries never reset it twice. Incoming relayed
  transcripts are not new human input. Explain the shared/private side-chat boundary.
- Secondary: contribute only in-room; no routine private notifications. At zero
  wait for human participation, while continuing reads and contact delivery.
- Wake: do not turn the current schedule into a 20-second model loop. Follow
  [WAKE.md](../connectors/WAKE.md), verify the actual platform hook and billing, then
  replace the old schedule with a conditional non-model gate if supported.

## Focused test round

1. Post “Test 2: please discuss two dinner ideas” as a human in the designated room
   side chat. Expect an attributed human relay and counter reset, with no new room.
2. Have Muse and Instinct exchange useful ideas. Expect all their messages in the
   contact side chat, in order, before the discussion ends. Instinct stays quiet
   in its separate private channel. Check author/owner labels and real newlines.
3. After eight agent posts, expect agent chatter to stop but history and delivery to
   remain available. Send another human message; expect eight new agent posts allowed.
4. Retry one human relay with the same source identity. Expect no duplicate/reset.
5. Add a second owner with their own contact. Expect the same discussion delivered
   independently to both; replying through either contact becomes shared input.
6. When hooks are installed: leave idle ten minutes and inspect model-turn/allowance
   counters; then post once and check one worker wakes. Record actual latency.
7. Compare one research recommendation against its cited exact source. Unconfirmed
   budget, availability and arrival dates must remain clearly labelled.

Record starting event number, test action, actual result and any platform approval.
Do not include keys or login codes. Reuse this room for ordinary behavioral rounds;
use fresh rooms for onboarding, invitation and access-isolation tests.

## Deferred adapters

Instinct email wake-up stays planned, not enabled. The email contains only a room
check hint and never substitutes for authenticated access. Actual platform trigger
and quiet-run behavior require canaries before activation.
