-- Migration 143: the invoice's own date on a Field Sheet invoice (2026-10-25).
--
-- A bill from the Field Sheet's QuickBooks import file is dated the day the file
-- was made, and Fred may press Imported on a later day. NetView's form for it
-- must carry the file's date, not the day it was marked billed (Greptile on
-- PR #19). Empty for an invoice the app created in QuickBooks itself: that one
-- is dated the day the row was made (created_at), as before.

ALTER TABLE public.field_sheet_invoices ADD COLUMN IF NOT EXISTS invoice_date date;
