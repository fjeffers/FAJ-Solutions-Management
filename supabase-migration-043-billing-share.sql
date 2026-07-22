-- Migration 043: billing helper link
--
-- billing_share_token powers /billing/<token> — a public, read-only page
-- showing ONLY the visits that still need invoicing (grouped by customer,
-- with amounts). Lets a second person help with billing without a login and
-- without seeing anything else in the app.

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS billing_share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_billing_token ON user_settings (billing_share_token);
