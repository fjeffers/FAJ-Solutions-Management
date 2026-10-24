-- Migration 136: the field sheet (Office → Field Sheet).
--
-- Fred, 2026-10-24: "add it under office and i can pull it by the app work
-- order number and edit whats needed". The office types a WO number and gets
-- the week from the techs' taps (drives, clock in and out, odometer, receipts,
-- photos), then fixes what the techs missed: an arrival nobody tapped, a day
-- that isn't in the app at all, a mileage figure. The taps themselves are never
-- changed; the office's figures sit on top of them here.
--
--   field_sheets      one per work order: the rates the bill uses (mileage,
--                     meals and hotel per the client's SOW), hotel nights and
--                     rooms. settings is a small JSON object.
--   field_sheet_days  one per tech per day on a work order: what the office
--                     changed (edits: {field: value}; a field set to null was
--                     emptied on purpose), whether the office added the day
--                     itself, and whether it's hidden from the sheet.
--
--   field_sheet_invoices  each QuickBooks invoice raised from a sheet: the
--                     dates it bills (a week, usually), the client, the number
--                     QuickBooks gave it, the total, and who it was emailed to.
--                     Written only by the server (/api/quickbooks/field-sheet-invoice):
--                     the row is taken BEFORE QuickBooks is called, with no
--                     invoice yet, and filled in when QuickBooks accepts it. One
--                     such row per work order at a time, so two tabs or two
--                     clicks can't both bill the same dates.
--
-- Fred, 2026-10-24: "when i finish it then save and uploaded into quickbooks
-- the same way ... and sent off the client"; "each site gets build on a
-- separate smartsheet". settings holds the client, the site location and how
-- the client is billed (hourly, blended, fixed or per item; mileage, meals,
-- hotel, receipts) — lib/field-sheet.ts parseSettings.
--
-- Owner only, like the rest of the office screens.

CREATE TABLE IF NOT EXISTS public.field_sheets (
  wo_id uuid PRIMARY KEY REFERENCES public.work_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_sheets_settings_shape CHECK (jsonb_typeof(settings) = 'object' AND pg_column_size(settings) < 8192)
);

CREATE TABLE IF NOT EXISTS public.field_sheet_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  day date NOT NULL,
  tech text NOT NULL,
  edits jsonb NOT NULL DEFAULT '{}'::jsonb,
  added boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_sheet_days_one_per_tech_day UNIQUE (wo_id, tech, day),
  CONSTRAINT field_sheet_days_edits_shape CHECK (jsonb_typeof(edits) = 'object' AND pg_column_size(edits) < 16384),
  CONSTRAINT field_sheet_days_tech_len CHECK (char_length(tech) BETWEEN 1 AND 120)
);
CREATE INDEX IF NOT EXISTS field_sheet_days_wo ON public.field_sheet_days (wo_id);

CREATE TABLE IF NOT EXISTS public.field_sheet_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  from_day date NOT NULL,
  to_day date NOT NULL,
  customer_name text NOT NULL,
  qbo_invoice_id text,
  qbo_invoice_number text,
  total numeric,
  sent_to text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_sheet_invoices_dates CHECK (to_day >= from_day)
);
CREATE INDEX IF NOT EXISTS field_sheet_invoices_wo ON public.field_sheet_invoices (wo_id, from_day);
-- An invoice being created (no QuickBooks id yet): one per work order at a time.
CREATE UNIQUE INDEX IF NOT EXISTS field_sheet_invoices_one_in_progress ON public.field_sheet_invoices (wo_id) WHERE qbo_invoice_id IS NULL;

ALTER TABLE public.field_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_sheet_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_sheet_days ENABLE ROW LEVEL SECURITY;

-- The owner's own sheets, on the owner's own work orders.
DROP POLICY IF EXISTS field_sheets_owner ON public.field_sheets;
CREATE POLICY field_sheets_owner ON public.field_sheets FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id = wo_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS field_sheet_days_owner ON public.field_sheet_days;
CREATE POLICY field_sheet_days_owner ON public.field_sheet_days FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id = wo_id AND w.user_id = auth.uid()));

-- The owner reads their invoices; only the server (service role) writes them.
DROP POLICY IF EXISTS field_sheet_invoices_owner_read ON public.field_sheet_invoices;
CREATE POLICY field_sheet_invoices_owner_read ON public.field_sheet_invoices FOR SELECT TO authenticated
  USING (user_id = auth.uid());
