-- Migration 109: Fred's own lists (Settings -> Lists & stages)
--
-- Fred, 2026-10-05: "full admin privilege in settings". One JSON value on his
-- user_settings row (migration 039, owner-only): office names for the job
-- stages, and his priorities, service types, job sources and assignment types
-- (names, order, hidden, which priorities count as high). lib/app-lists.ts
-- checks it on every load. Each choice keeps the value stored on jobs; only
-- its name changes, and nothing is ever deleted, so old jobs are untouched.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS lists JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_lists_size;
ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_lists_size CHECK (pg_column_size(lists) < 65536);
