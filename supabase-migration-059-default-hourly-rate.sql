-- Migration 059: your standard T&M hourly rate, so a new visit starts priced
--
-- The Invoice Tracker carries this as a global on Master Entry ("T&M Hourly
-- Rate: 55"). The app had no equivalent, so every new visit started with an
-- empty price and had to be typed from memory. A setting rather than a
-- constant, so the rate can change without a code change.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS default_hourly_rate NUMERIC NOT NULL DEFAULT 55;

COMMENT ON COLUMN user_settings.default_hourly_rate IS
  'Standard T&M rate used to pre-fill the price on a new site visit. Editable per visit.';
