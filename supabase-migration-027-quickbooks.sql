-- Migration 027: QuickBooks Online sync (Phase 11)
--
-- Reuses the exact security model migration-026 introduced for Gmail: refresh_token is
-- never selectable by the browser client, only the service-role sync/callback routes touch it.

CREATE TABLE IF NOT EXISTS quickbooks_connections (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  realm_id                  TEXT        NOT NULL,
  company_name              TEXT,
  environment               TEXT        NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  refresh_token             TEXT        NOT NULL,
  access_token              TEXT,
  token_expires_at          TIMESTAMPTZ,
  default_expense_account_id  TEXT,
  default_expense_account_name TEXT,
  default_payment_account_id  TEXT,
  default_payment_account_name TEXT,
  connected_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE quickbooks_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own QBO connection status"
  ON quickbooks_connections FOR SELECT
  USING (auth.uid() = user_id);

REVOKE SELECT (refresh_token, access_token) ON quickbooks_connections FROM authenticated, anon;

-- No INSERT/UPDATE/DELETE policy for authenticated/anon — every write (including the account-
-- mapping choice) goes through a server route using the service-role key, same as
-- gmail_connections, so a client can never touch refresh_token/access_token even via a blind
-- UPDATE.

ALTER TABLE contractors ADD COLUMN IF NOT EXISTS qbo_vendor_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS qbo_synced_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS qbo_transaction_id TEXT;
