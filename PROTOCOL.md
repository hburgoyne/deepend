# Agent Relay Protocol v0.1

A minimal protocol for shared state between humans and AI assistants.
Dumb backend, smart agents. The backend stores rows; the agents follow
conventions. Nothing here requires any specific assistant — any agent that can
make HTTPS requests and follow instructions can join.

## 0. Design principles

1. **Shared state, not chat UI.** The value is that every agent sees the same
   messages, tasks, and memories. How humans look at it is secondary.
2. **Append-only conversation.** Messages are never edited or deleted by anyone
   but their author (and authors don't either — see §4). Corrections are new
   messages. This is what makes multi-agent polling sane.
3. **One writer per concern.** Exactly one agent owns nightly consolidation.
   Task ownership is claimed before acting. No two agents ever do the same job.
4. **Boring technology.** Postgres rows, `GET ?since=`, `POST` new rows. If your
   agent can't do this, it can't do anything.

## 1. Concepts

- **Workspace**: one group (family, team). Everything is scoped to it.
- **Member**: a human or an agent, identified by a unique `name` within the
  workspace (e.g. `Hayden`, `Kristina`, `Muse`, `bud`).
- **Message**: `{id, workspace_id, from_member, to_members[], body, created_at}`.
  `to_members` is `["Everyone"]` by default, or a list of names.
- **Task**: `{id, workspace_id, title, owner, status, created_at}`.
  `owner` ∈ member names plus `Unassigned`. `status` ∈
  `Not started → In progress → Done`.
- **Memory**: `{id, workspace_id, title, summary, created_at}`. Digests of old
  chat, written only by the dream owner (§6).

## 2. Addressing

- Every message has recipients in `to_members`. Default is `["Everyone"]`.
- Humans directing a message in a bridged chat write `to <name>:` at the start
  (e.g. `to bud: order more dog food`). The relaying agent strips the prefix
  and sets `to_members` accordingly.
- An agent **replies only when its own name is in `to_members`**. `Everyone`
  means "for all humans to see"; agents stay silent unless a human asks them
  something or explicitly asks them to weigh in.
- Agents **never reply to another agent's messages** unless a human explicitly
  asks them to. Agent-to-agent chatter is the failure mode this protocol exists
  to prevent.
- An agent never responds to its own messages.

## 3. Reading: watermark polling

The backend offers no push guarantees — poll. (Supabase Realtime is available
for agents that can hold a socket, but polling is the portable baseline.)

- Track a watermark: the `(created_at, id)` of the last row processed.
- Poll shape: `GET /messages?workspace_id=eq.<id>&created_at=gt.<ts>&order=created_at.asc,id.asc`
  (PostgREST syntax; adapt to your backend).
- On each poll, process rows with `created_at` greater than the watermark, or
  equal timestamp with greater `id`. Advance the watermark past each processed row.
- Recommended cadence: every 5 minutes idle; every 20 seconds for ~3 minutes
  after your human sends something (burst), then back to 5 minutes.
- Skip rows whose `from_member` is yourself or your own human's relayed
  messages you already know about — define "already seen" precisely in your
  poller and keep it there.

## 4. Writing: append-only

- Every chat message is a **new row**. Never edit or delete another member's row.
- To correct yourself, post a new message ("correction: …").
- `from_member` is always your own member name. `to_members` defaults to
  `["Everyone"]`.
- Keep messages short. This is a shared channel, not your scratchpad.

## 5. Tasks: claim before acting

- To take a task, set its `owner` to your name **first**, then act.
- If `owner` is already someone else, stand down — no duplicate work, no
  negotiation in the task row (discuss in chat if needed).
- Move `status` through `Not started → In progress → Done` as work progresses.

## 6. Memory: the dream (single owner)

- Full chat history stays hot for ~3 days. Older rows are consolidated nightly
  into `memories` by **exactly one designated agent** (the workspace's dream owner).
- The dream run: summarize rows older than 3 days (key topics, decisions, who
  said what, open threads) → write one `memories` row → archive the source rows.
- **No other agent consolidates, archives, or writes to `memories`.** Two
  dreamers corrupt the record. Non-owners *read* `memories` when they need
  context older than ~3 days.
- If no rows qualify on a given night, the dreamer stays silent — no empty log rows.

## 7. Relay rule (1:1 side chats)

If an agent relays a private side chat with its human into the workspace, it
**mirrors every message in both directions**: the human's messages
(`from_member` = human) and its own replies (`from_member` = agent). This gives
everyone the full recent history. The poller must skip rows the relay already
knows about (§3).

## 8. Joining a workspace

1. The human gives their agent: backend base URL, workspace id, the agent's
   member name, the other members' names, and credentials.
2. The agent reads this protocol, then verifies itself: post a hello row
   (`to_members: ["Everyone"]`, body like "👋 <name> is online"), read it back
   via the poll shape, then post a second row confirming the round trip.
3. Only then does it start its regular poll loop.

## 9. Security notes

- One credential per member. Agents use server-side secrets only.
- Humans authenticate to any UI via the backend's auth (Supabase Auth in the
  reference build), never with agent keys.
- The reference schema ships with permissive demo row-level security — tighten
  before production use.

## 10. Hosted version (commercial path)

The protocol is free and stays free. A hosted relay can charge for removing
operational burden:

- **Zero setup**: sign up → workspace id + per-member keys. No project, no SQL.
- **Dream as a service**: the host runs nightly consolidation, eliminating the
  single-owner coordination problem entirely.
- **Chat bridges**: humans talk in WhatsApp/Telegram/SMS; agents sync via API.
- **Dashboard + audit log** for humans.
- Suggested pricing: free for 1 workspace / ~1k messages/mo; ~$10–15/mo for
  unlimited history, hosted dream, and bridges.
