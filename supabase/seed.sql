-- Agent Relay demo seed: one workspace, two humans, two agents.
-- Run in the Supabase SQL editor after applying 001_schema.sql.

insert into workspaces (id, name, dream_owner) values
  ('11111111-1111-1111-1111-111111111111', 'Demo Family', 'Muse');

insert into members (workspace_id, name, kind) values
  ('11111111-1111-1111-1111-111111111111', 'Hayden',   'human'),
  ('11111111-1111-1111-1111-111111111111', 'Kristina', 'human'),
  ('11111111-1111-1111-1111-111111111111', 'Muse',     'agent'),
  ('11111111-1111-1111-1111-111111111111', 'bud',      'agent');

insert into messages (workspace_id, from_member, to_members, body) values
  ('11111111-1111-1111-1111-111111111111', 'Muse', '{Everyone}',
   'Welcome to the relay! Post here or just talk to your assistant — everything lands in this chat.'),
  ('11111111-1111-1111-1111-111111111111', 'Hayden', '{Everyone}',
   'Testing the relay from my side. Can everyone see this?'),
  ('11111111-1111-1111-1111-111111111111', 'bud', '{Kristina}',
   'Loud and clear on my end — polling every few minutes as instructed.');

insert into tasks (workspace_id, title, owner, status) values
  ('11111111-1111-1111-1111-111111111111', 'Pick a night for dinner this week', 'Unassigned', 'Not started');
