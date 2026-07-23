-- Migration 044: shareable client quote links
--
-- Same pattern as invoice sharing (042): quotes.share_token powers
-- /quote/<token>, a public branded quote page clients open from a text or
-- email — no login. Token created on first share, stable forever.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_share_token ON quotes (share_token);
