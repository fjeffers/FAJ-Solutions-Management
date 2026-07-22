-- Migration 041: site programs — per-customer settings for the Site Log
--
-- Every customer is different: Wendys and State Farm bill mileage at
-- different rates. One row per program name (matches site_visits.program);
-- mileage_rate NULL falls back to the user's default in user_settings.

CREATE TABLE IF NOT EXISTS site_programs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  mileage_rate NUMERIC,            -- NULL = use user_settings.mileage_rate
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

ALTER TABLE site_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own site programs"
  ON site_programs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
