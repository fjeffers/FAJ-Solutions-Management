-- Migration 042: shareable client invoice links
--
-- share_token powers /invoice/<token> — a public, login-free, branded
-- invoice page the user can text or email to a client. Token is generated
-- on first share from the Invoices view; the public page reads via the
-- service-role client (route allowed through the auth proxy).

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_share_token ON invoices (share_token);
