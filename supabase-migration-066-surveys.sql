-- Migration 066: site surveys — the front of the job pipeline
--
-- The chain already ran Quote → Work Order → Visits/Payments/Invoice. What was
-- missing was the step BEFORE the quote: the walk-through. Fred surveys a site,
-- writes the findings in Word, then re-types the whole scope into a quote by
-- hand. Two documents, no link, and nothing ties the finished job back to what
-- was promised on the walk-through.
--
-- A survey now lives in the app. Its scope lines carry description/qty/rate,
-- which is exactly a quote line, so "Build Quote from Survey" is a copy, not a
-- re-type. From there the existing chain takes over untouched.
--
--   surveys.quote_id      → the quote it produced
--   surveys.work_order_id → stamped when that quote is accepted
--   quotes.survey_id      → the walk-through this quote came from
--
-- Every link is ON DELETE SET NULL. Deleting a survey must never take a quote,
-- work order, or invoice with it.

CREATE TABLE IF NOT EXISTS surveys (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  survey_number  TEXT        NOT NULL,          -- S-2026-001

  -- Who it's for. customer_id is the join key; the text fields stay as the
  -- human-entered label, same convention as migration 046.
  customer_id    UUID        REFERENCES customers(id) ON DELETE SET NULL,
  client_name    TEXT,
  client_email   TEXT,
  client_phone   TEXT,
  poc_name       TEXT,
  poc_phone      TEXT,

  -- Where it is. Mirrors work_orders' site_* columns so the hand-off to a
  -- work order is a straight copy.
  site_name      TEXT,
  site_address   TEXT,
  site_city      TEXT,
  site_state     TEXT,
  site_zip       TEXT,

  -- The walk-through itself
  title          TEXT,
  survey_date    DATE,
  surveyed_by    TEXT,
  status         TEXT        NOT NULL DEFAULT 'draft',  -- draft|completed|quoted|won|lost
  existing_conditions TEXT,   -- what's on site today
  findings       TEXT,        -- problems found
  recommendations TEXT,       -- what FAJ proposes
  notes          TEXT,

  -- Scope lines: [{ id, description, quantity, unit, rate, notes }]
  -- description/quantity/rate map 1:1 onto QuoteLineItem.
  scope_items    JSONB       NOT NULL DEFAULT '[]'::JSONB,

  -- Pricing assumptions captured on site, carried into the quote
  labor_rate     NUMERIC,
  labor_hours    NUMERIC,
  tax_rate       NUMERIC     NOT NULL DEFAULT 0,
  payment_terms  TEXT,

  -- [{ url, caption }] — photos from the walk-through
  photos         JSONB       NOT NULL DEFAULT '[]'::JSONB,

  -- Where this survey went
  quote_id       UUID        REFERENCES quotes(id)       ON DELETE SET NULL,
  work_order_id  UUID        REFERENCES work_orders(id)  ON DELETE SET NULL,

  share_token    TEXT,       -- powers /survey/<token>, same pattern as quotes
  archived_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, survey_number)
);

ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own surveys" ON surveys;
CREATE POLICY "Users manage own surveys"
  ON surveys FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- The back-link: a quote knows which walk-through produced it.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS survey_id UUID REFERENCES surveys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_surveys_customer   ON surveys (customer_id);
CREATE INDEX IF NOT EXISTS idx_surveys_quote      ON surveys (quote_id);
CREATE INDEX IF NOT EXISTS idx_surveys_work_order ON surveys (work_order_id);
CREATE INDEX IF NOT EXISTS idx_surveys_status     ON surveys (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_surveys_share_token ON surveys (share_token);
CREATE INDEX IF NOT EXISTS idx_quotes_survey      ON quotes  (survey_id);
