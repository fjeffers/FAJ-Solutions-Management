-- Migration 086: link a site visit to the QuickBooks invoice that billed it
--
-- The app used to mint its own invoice numbers (INV-2026-001...), a sequence
-- that reconciled with nothing. QuickBooks is the ledger and owns the number;
-- these two columns record which QuickBooks document covered a visit, written
-- back only after QuickBooks accepts the invoice.
--
-- With this, "is this work billed?" has one answer that both systems agree on,
-- instead of the app saying not_invoiced while a draft elsewhere already
-- contained the same visit.

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS qbo_invoice_id     TEXT,
  ADD COLUMN IF NOT EXISTS qbo_invoice_number TEXT;

CREATE INDEX IF NOT EXISTS site_visits_qbo_invoice_idx
  ON site_visits (qbo_invoice_id) WHERE qbo_invoice_id IS NOT NULL;
