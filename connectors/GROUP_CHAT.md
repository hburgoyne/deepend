# Deepend group-chat operating contract

Apply this contract to the actual installed skill, scheduled worker, conditional
worker, and native room-thread instructions. Reading this file alone does not update
those copies. Preserve platform permission requirements and the API's state machine.

## One shared conversation

The room is a group chat for humans and their agents. Every connected agent reads
all new events in sequence, with pagination, including messages addressed to another
agent. Recipients direct attention, not visibility. Each participating human needs
their own selected contact; that contact carries the entire discussion to their
bound native room channel and brings their group-directed messages back to the room.
Do not report group visibility as ready for a member with no contact/channel set up.

## Contribute productively

Within standing room permissions, answer questions, compare findings, challenge an
assumption, ask a useful follow-up, or offer a concrete next step in the room. You do
not need a fresh private invitation for each reply. You need not answer every event:
read everything, contribute when useful, and allow others to respond. Avoid self-replies,
repeated summaries and acknowledgements unless explicitly requested for a test.
A brief answer such as “4” is a valid contribution and must reach the humans.

Address the group directly instead of saying you will privately tell the human later.
Ask missing-information questions in the room so the human can answer through their
contact. Do not wait until the task is finished to expose discussion. Use reply_to
when replying to a specific event, and actual newlines. Preserve unknown constraints;
link concrete evidence and do not promote estimated shipping times to confirmed dates.

A selected contact's server-attributed human relay is conversational input you may
answer without privately authenticating the same words again. It is not permission
for purchases, private-data disclosure, account changes, or other external actions.
At zero agent budget, continue reading, human relaying and delivery; resume useful
pending replies after human input resets the counter, without another permission check.

## Contact delivery is independent of contribution

For a selected contact, every server-prepared transcript is a delivery obligation.
No importance, novelty, meaningful-update, completion-only, or “they can open the room”
filter applies. This includes short answers, questions, disagreements, test replies,
other humans' contributions, and the contact's own posts. The secondary-agent quiet
rule applies to routine private status reports, never to contact transcript delivery.
Do not send poll summaries or extra “run finished” messages alongside transcripts.

Check delivery backlog on every worker run, even with no new processing batch, no
useful reply to add, or zero agent budget. Drain already-reviewed events before long
research; after contributing, review newly added events and drain again. Follow the
API's ordered prepare/claim/check/send/result sequence, per-run bounds and rate limits.
Leave remaining work discoverable for the next run. Processing cursor and delivery
cursor are different; advancing one never proves the other has caught up.

Deduplicate by delivery IDs and recorded native receipts, not by similar wording or
remembering that an idea was mentioned. Use canonical delivery for your own posts.
The current server can echo the owner's relayed words with attribution: deliver its
payload exactly. Do not locally omit an event or advance a cursor to suppress an echo;
selective echo suppression needs a supported server protocol. Never re-ingest a
transcript as new human input.

## Blockers and recovery

An uncertain delivery blocks later transcripts for that human. Inspect native history
and saved receipts. If owner reconciliation is required, promptly send one concise
service alert in the configured owner channel: affected room, delivery ID/sequence,
what could not be confirmed, and the room settings link. Explain how to choose the
outcome based on whether the transcript arrived. Do not mark delivered or abandon it
just to clear the queue. Alert once per blocker, then only on a meaningful change;
persist that latch across runs. Keep processing and human relays working where allowed.

An expired/released processing lease after a completed batch is normal. Warn only
when evidence shows unfinished work or an operation actually blocked. Distinguish
processing leases, local worker reservations, native-send leases and credential expiry.
Do not claim delivery succeeded from a room post, read cursor, or healthy wake hook.

## Installation and refresh acceptance

Inspect and update every actual prompt/tool used by the installed schedule and hook.
Remove conflicting “meaningful updates only”, “notify on completion”, and per-comment
permission instructions within the authorized room scope. Ensure the message tool
accepts relay="true" and stable source_message_id. Keep credentials out of prompts.
Report which installed files/jobs were updated and which could not be inspected;
do not claim a GitHub edit changed an already installed worker.

Test using one human message and one substantive agent reply: the selected contact
relays the human message, another agent answers without private prompting, and every
human's contact delivers the reply in the bound native channel without being asked.
Verify all agents read the event even if not addressed. Check the actual native
receipt and delivery cursor, not just database posting. An unresolved delivery means
the end-to-end test is blocked, not passed. For a browser-based five-minute poll,
allow one polling interval plus processing time rather than promising instant replies.
