-- Migration 033: Invoices — accounts receivable (client → FAJ)
--
-- Until now the money model only tracked payouts to techs (payments table).
-- invoices records what clients are billed; invoice_payments records what they
-- actually paid. Balance/overdue/partial states are derived app-side from the
-- sum of a invoice's payments vs its total — only draft/sent/paid/void persist.
--
-- work_order_ids: one invoice can bill several work orders (e.g. a monthly
-- roll-up for a repeat client). Stored as an array, derived from line items.

CREATE TABLE IF NOT EXISTS invoices (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_number TEXT        NOT NULL,
  client_name    TEXT,
  client_email   TEXT,
  client_phone   TEXT,
  title          TEXT,
  description    TEXT,
  line_items     JSONB       NOT NULL DEFAULT '[]',
  subtotal       NUMERIC     NOT NULL DEFAULT 0,
  tax_rate       NUMERIC     NOT NULL DEFAULT 0,
  tax_amount     NUMERIC     NOT NULL DEFAULT 0,
  total          NUMERIC     NOT NULL DEFAULT 0,
  status         TEXT        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  due_date       DATE,
  notes          TEXT,
  sent_at        TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  work_order_ids UUID[]      NOT NULL DEFAULT '{}',
  quote_id       UUID        REFERENCES quotes(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, invoice_number)
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own invoices"
  ON invoices FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_id   UUID        NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount       NUMERIC     NOT NULL,
  payment_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  method       TEXT        NOT NULL DEFAULT 'Zelle',
  reference    TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own invoice payments"
  ON invoice_payments FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments (invoice_id);
