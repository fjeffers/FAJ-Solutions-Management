-- Migration 038: Site visit log — lightweight per-visit tracking
--
-- The user tracked this in a "Projects" spreadsheet (one sheet per program:
-- Wendys, State Farm): site id/code, location, date, hours on site, rate,
-- Project vs T&M vs Revisit, invoice + payment status, miles, notes. This is
-- deliberately lighter than work_orders — a phone-first field log. time_in /
-- time_out power a live check-in/check-out timer; hours is what gets billed
-- (auto-filled from the timer, editable).

CREATE TABLE IF NOT EXISTS site_visits (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program        TEXT,               -- client/program: "Wendys", "State Farm"...
  site_code      TEXT,               -- their site id or WO number: "5798", "WO0054855"
  site_name      TEXT,
  address        TEXT,
  visit_date     DATE,               -- nullable: "Date TBD" rows exist
  time_in        TIMESTAMPTZ,
  time_out       TIMESTAMPTZ,
  hours          NUMERIC,
  rate           TEXT,               -- free text: "$55/hr", "2600", "$250 flat rate"
  visit_type     TEXT        NOT NULL DEFAULT 'T&M'
                              CHECK (visit_type IN ('Project', 'T&M', 'Revisit', 'Survey', 'Other')),
  invoice_status TEXT        NOT NULL DEFAULT 'not_invoiced'
                              CHECK (invoice_status IN ('not_invoiced', 'invoiced', 'na')),
  payment_status TEXT        NOT NULL DEFAULT 'unpaid'
                              CHECK (payment_status IN ('unpaid', 'paid', 'na')),
  miles          NUMERIC,
  travel_charge  NUMERIC,
  notes          TEXT,
  work_order_id  UUID        REFERENCES work_orders(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own site visits"
  ON site_visits FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_site_visits_date ON site_visits (user_id, visit_date DESC);
