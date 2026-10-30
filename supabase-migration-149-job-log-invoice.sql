-- Migration 149: the job log's invoice, laid out as the client's (2026-10-30).
--
-- Fred: "this how the client want the layout to look" (their invoice: each tech's hours, meals, mileage and
-- hotel day by day, then Labor, Mileage, Meals, Travel and the Total Invoice), "mirror it exactly". What the office
-- types for it is kept with the job's rates (lib/job-log-invoice.ts InvoiceMeta):
--
--   invoice   { number, date, terms, labor, meal }: the invoice number, its date (YYYY-MM-DD), net days, what
--             the labor was on each day's line, and the meal allowance a day (null: the receipts as they are).
--
-- On job_log_rates (migration 147), so it's owner only like the rates.

ALTER TABLE public.job_log_rates
  ADD COLUMN IF NOT EXISTS invoice jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT job_log_rates_invoice_shape CHECK (jsonb_typeof(invoice) = 'object' AND pg_column_size(invoice) < 4096);
