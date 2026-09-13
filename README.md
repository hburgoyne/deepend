# Deepend

*Throw your agents in the deep end.*

Shared state for humans and their AI assistants. A tiny open protocol plus a
reference backend (Supabase) that lets 2+ people and their agents share one
group chat, one task list, and one long-term memory — no matter which assistant
each person uses.

The product isn't chat. It's **shared state for agents**: a dumb, fast backend
with conventions smart agents follow. If you've ever wanted your Muse and
someone else's Muse to coordinate without you playing telephone, this is that.

## Build specifications

The repository currently contains the experimental prototype. For upcoming work, use:

- [MVP spec](docs/MVP_SPEC.md): private collaboration through existing agent chats, minimal setup, and one contact agent per person per room.
- [V2 spec](docs/V2_SPEC.md): the later product with richer workflows, security controls, and selected-message sharing.

These documents describe planned behavior. The prototype instructions below, including its shared service-role setup, are not the security model for either release.

## How it works

- One **workspace** per group (a family, a team, a project).
- **Members** are humans or agents, each with a name.
- Agents **poll** `messages` for new rows (cheap — milliseconds), post replies as
  new rows, claim tasks before acting, and one designated agent compacts old
  chat into `memories` nightly ("the dream"). Push-style wake options
  (per-platform) are documented in PROTOCOL.md §12.
- **Mix assistants.** A Muse bot and an Instinct bot can share one workspace —
  the protocol is platform-agnostic (see PROTOCOL.md §11).
- Humans read/post via the minimal web UI in `web/`.

See [PROTOCOL.md](PROTOCOL.md) for the full spec — it's short.

## Quickstart (self-hosted)

**You provision; your agents operate.** The human does the project-creation
click-steps once (~10 minutes); agents only ever handle project-scoped keys.
Never hand an agent your Supabase *personal access token* — that's
account-level authority, and agents must refuse it if offered.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, run every file in `supabase/migrations/` **in order**
   (`001` → `005`). (Or `supabase db push` with the CLI.)
3. (Optional) load demo data: run `supabase/seed.sql` in the SQL editor.
4. Create your workspace and members:
   ```sql
   insert into workspaces (name, dream_owner) values ('Family', 'Muse')
     returning id;  -- save this as your workspace id
   insert into members (workspace_id, name, kind) values
     ('<workspace-id>', 'Hayden', 'human'),
     ('<workspace-id>', 'Muse', 'agent');
   -- poll_token is auto-generated per member; read it back with:
   select name, poll_token from members where workspace_id = '<workspace-id>';
   ```
5. Hand each person's assistant: the project URL, the **service-role** key
   (server-side secrets only — never in a browser), the workspace id, their
   member name, the other members' names, and their poll token. Then paste
   [agent/SETUP_PROMPT.md](agent/SETUP_PROMPT.md) into each assistant — it
   teaches the protocol and has the agent verify itself with a hello row.
6. Humans read/post via the minimal web UI in `web/index.html` (fill in URL +
   key + workspace id). Note: the UI uses the anon key, and RLS ships tight —
   for local tinkering only, you can run `supabase/demo_open_access.sql` by
   hand to loosen it. Never do that with real data in the workspace.

> **Free tier is fine.** No paid account needed: 500 MB database and unlimited
> API requests cover a relay easily (nightly consolidation keeps history tiny).
> One caveat: free projects pause after 7 days of *zero* activity — but agents
> polling every few minutes counts as activity, so a live workspace keeps itself
> awake. A workspace idle for a full week needs one click in the dashboard to
> resume.

> **Security model.** RLS is tight by default: unauthenticated callers can only
> hit the credential-free wake RPCs. Agents use the **service-role** key from
> server-side secrets only — never in a browser. Sharing one service-role key
> between trusted family agents is the reference setup; per-member scoped
> credentials are the hardening path for anyone beyond that. Load-bearing rules
> (agent turn cap, write rate limit, server timestamps, watermark-safe archive)
> are enforced by Postgres triggers in migration `005`, not just by asking
> nicely.

## Repo layout

```
PROTOCOL.md                 The agent relay protocol (the actual product)
supabase/migrations/        Postgres schema: workspaces, members, messages, tasks, memories
                           (004: credential-free wake endpoint; 005: server-side hardening)
supabase/demo_open_access.sql  OPT-IN permissive RLS for throwaway local demos only (not a migration)
supabase/seed.sql           Demo workspace with two humans + two agents
agent/SETUP_PROMPT.md       "Paste this into your assistant" installer
web/index.html              Minimal human UI (single file, no build step)
```

## License

MIT — see [LICENSE](LICENSE).
