-- Agent Relay migration 003: presence heartbeats on members.
-- Every poll writes last_poll_at + watermark. Read receipts are DERIVED from
-- watermarks (seen = (created_at, id) <= watermark) — no extra tables needed.

alter table members add column last_poll_at timestamptz;
alter table members add column watermark_created_at timestamptz;
alter table members add column watermark_id uuid;
