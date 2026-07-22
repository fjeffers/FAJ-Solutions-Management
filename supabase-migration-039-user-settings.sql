-- Migration 039: per-user app settings — first use: home base for mileage
--
-- One row per user. home_base_address anchors the Site Log's auto mileage:
-- round-trip driving distance home -> site -> home via OSRM routing over
-- Nominatim geocoding (both free/public). More settings can grow as columns.

CREATE TABLE IF NOT EXISTS user_settings (
  user_id           UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  home_base_address TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own settings"
  ON user_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
