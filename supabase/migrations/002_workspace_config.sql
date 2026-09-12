-- Agent Relay migration 002: workspace config (persistent tunables).
-- Tunables change only on explicit user request — set once, not toggled.

alter table workspaces
  add column config jsonb not null default '{"max_agent_turns": 3}';

comment on column workspaces.config is
  'Persistent tunables; change only when a user asks. max_agent_turns: max consecutive agent-only exchanges per thread before looping humans back in.';
