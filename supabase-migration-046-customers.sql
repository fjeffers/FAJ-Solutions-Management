-- Migration 046: customer master — the ERP/CRM foundation
--
-- Until now every module stored the customer as loose text and they drifted:
-- work_orders.customer_name held both 'Wendy''s' and 'Wendy''s ' (trailing
-- space), invoices.client_name held 'Wendys', and site_visits.program held
-- 'Wendys' across 42 visits. Four spellings of one customer, so revenue,
-- visits and invoices could not be joined — "what did Wendy's make me this
-- year" was unanswerable.
--
-- This adds one canonical record everything points at, plus the CRM tables
-- (contacts, activity) that hang off it, plus an alias table so the messy
-- historical spellings — and future email imports — keep resolving.
--
-- The free-text columns are deliberately LEFT IN PLACE. They stay as the
-- human-entered label; customer_id becomes the join key. Nothing is dropped,
-- so this migration cannot lose data and is safe to apply to live.

-- ── The master record ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,          -- canonical display name
  -- CRM pipeline: where this relationship stands
  status               TEXT        NOT NULL DEFAULT 'active',  -- lead|prospect|active|dormant|lost
  industry             TEXT,
  source               TEXT,                          -- how they found FAJ
  -- Billing profile
  billing_email        TEXT,
  billing_phone        TEXT,
  address              TEXT,
  city                 TEXT,
  state                TEXT,
  zip                  TEXT,
  payment_terms        TEXT,                          -- e.g. 'Net 30'
  default_mileage_rate NUMERIC,                       -- NULL = fall back to user_settings
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own customers" ON customers;
CREATE POLICY "Users manage own customers"
  ON customers FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Aliases: every spelling that means this customer ───────────────────────
-- Lets the backfill fold 'Wendys' / 'Wendy''s ' / 'Wendys' into one record,
-- and lets the email-import queue auto-match a customer on future jobs.
CREATE TABLE IF NOT EXISTS customer_aliases (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  alias       TEXT        NOT NULL,   -- stored lower-cased and trimmed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, alias)
);

ALTER TABLE customer_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own customer aliases" ON customer_aliases;
CREATE POLICY "Users manage own customer aliases"
  ON customer_aliases FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── CRM: people at the customer ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_contacts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  title       TEXT,
  email       TEXT,
  phone       TEXT,
  is_primary  BOOLEAN     NOT NULL DEFAULT FALSE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own customer contacts" ON customer_contacts;
CREATE POLICY "Users manage own customer contacts"
  ON customer_contacts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── CRM: the relationship history ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_activity (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contact_id  UUID        REFERENCES customer_contacts(id) ON DELETE SET NULL,
  kind        TEXT        NOT NULL DEFAULT 'note',  -- call|email|meeting|note|quote|invoice|job
  subject     TEXT,
  body        TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE customer_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own customer activity" ON customer_activity;
CREATE POLICY "Users manage own customer activity"
  ON customer_activity FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Point the existing modules at the master record ────────────────────────
-- Nullable on purpose: legacy rows stay valid while the backfill runs, and a
-- work order without a customer is still a real work order.
--
-- ON DELETE SET NULL, never CASCADE: deleting a customer must never delete
-- invoices, payments, or job history. Losing financial records to a tidy-up
-- click is not a risk worth taking.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE invoices    ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE quotes      ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_customer ON work_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer    ON invoices    (customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_customer      ON quotes      (customer_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_customer ON site_visits (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer ON customer_contacts (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_activity_customer ON customer_activity (customer_id, occurred_at DESC);
