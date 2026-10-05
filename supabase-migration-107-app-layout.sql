-- Migration 107: Fred's own menu layout (Settings -> Menu & screens)
--
-- Fred, 2026-10-05: "I want setting to be able to create or change layouts of
-- the app, add, remove anything — full admin privilege in settings."
--
-- One JSON value on his existing user_settings row (migration 039, which
-- already limits every row to its own user). It holds only names, order and
-- what's hidden; lib/app-layout.ts checks it on every load, so a bad value
-- falls back to the standard menu instead of breaking the app. Hiding a
-- screen only takes it off the menu — no data is touched.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS layout JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_layout_size;
ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_layout_size CHECK (pg_column_size(layout) < 65536);
