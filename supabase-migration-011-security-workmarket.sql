-- Migration 011: security hardening + Field Nation / WorkMarket-style work order fields

-- Marketplace-style work order metadata
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'Internal',
  ADD COLUMN IF NOT EXISTS external_wo_id text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS project_name text,
  ADD COLUMN IF NOT EXISTS client_reference text,
  ADD COLUMN IF NOT EXISTS buyer_company text,
  ADD COLUMN IF NOT EXISTS assignment_type text NOT NULL DEFAULT 'Internal',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'Normal',
  ADD COLUMN IF NOT EXISTS schedule_type text NOT NULL DEFAULT 'Exact Time',
  ADD COLUMN IF NOT EXISTS time_zone text,
  ADD COLUMN IF NOT EXISTS deliverable_instructions text,
  ADD COLUMN IF NOT EXISTS tools_required text,
  ADD COLUMN IF NOT EXISTS parts_materials text,
  ADD COLUMN IF NOT EXISTS access_instructions text,
  ADD COLUMN IF NOT EXISTS parking_instructions text,
  ADD COLUMN IF NOT EXISTS check_in_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS check_out_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS signature_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expense_budget numeric,
  ADD COLUMN IF NOT EXISTS travel_amount numeric,
  ADD COLUMN IF NOT EXISTS bonus_amount numeric;

ALTER TABLE deliverable_submissions
  ADD COLUMN IF NOT EXISTS file_urls text[] DEFAULT '{}';

-- Tables used by the contractor portal. These may already exist in production;
-- the IF NOT EXISTS form makes a fresh database setup reproducible.
CREATE TABLE IF NOT EXISTS time_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  wo_number text NOT NULL,
  contractor_name text NOT NULL,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  wo_number text NOT NULL,
  contractor_name text NOT NULL,
  signer_name text,
  signature_data text NOT NULL,
  signed_at timestamptz DEFAULT now()
);

ALTER TABLE time_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contractors_insert_time_logs" ON time_logs;
CREATE POLICY "contractors_insert_time_logs" ON time_logs
FOR INSERT WITH CHECK (
  contractor_name IN (SELECT name FROM contractors WHERE email = auth.email())
  AND EXISTS (
    SELECT 1 FROM work_orders wo
    WHERE wo.id = wo_id AND wo.contractor_name = contractor_name
  )
);

DROP POLICY IF EXISTS "contractors_view_time_logs" ON time_logs;
CREATE POLICY "contractors_view_time_logs" ON time_logs
FOR SELECT USING (
  contractor_name IN (SELECT name FROM contractors WHERE email = auth.email())
);

DROP POLICY IF EXISTS "contractors_update_time_logs" ON time_logs;
CREATE POLICY "contractors_update_time_logs" ON time_logs
FOR UPDATE USING (
  contractor_name IN (SELECT name FROM contractors WHERE email = auth.email())
) WITH CHECK (
  contractor_name IN (SELECT name FROM contractors WHERE email = auth.email())
);

DROP POLICY IF EXISTS "admin_manage_time_logs" ON time_logs;
CREATE POLICY "admin_manage_time_logs" ON time_logs
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM work_orders wo
    WHERE wo.id = wo_id AND wo.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM work_orders wo
    WHERE wo.id = wo_id AND wo.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "contractors_insert_signatures" ON signatures;
CREATE POLICY "contractors_insert_signatures" ON signatures
FOR INSERT WITH CHECK (
  contractor_name IN (SELECT name FROM contractors WHERE email = auth.email())
  AND EXISTS (
    SELECT 1 FROM work_orders wo
    WHERE wo.id = wo_id AND wo.contractor_name = contractor_name
  )
);

DROP POLICY IF EXISTS "contractors_view_signatures" ON signatures;
CREATE POLICY "contractors_view_signatures" ON signatures
FOR SELECT USING (
  contractor_name IN (SELECT name FROM contractors WHERE email = auth.email())
);

DROP POLICY IF EXISTS "admin_manage_signatures" ON signatures;
CREATE POLICY "admin_manage_signatures" ON signatures
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM work_orders wo
    WHERE wo.id = wo_id AND wo.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM work_orders wo
    WHERE wo.id = wo_id AND wo.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "users_insert_own_audit_log" ON audit_log;
CREATE POLICY "users_insert_own_audit_log" ON audit_log
FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_view_own_audit_log" ON audit_log;
CREATE POLICY "users_view_own_audit_log" ON audit_log
FOR SELECT USING (auth.uid() = user_id);

-- Contractors can update field-progress fields only. Admin updates remain
-- unrestricted when the row's user_id matches auth.uid().
CREATE OR REPLACE FUNCTION public.enforce_contractor_work_order_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  is_contractor boolean;
  old_locked jsonb;
  new_locked jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.contractors c
    WHERE lower(c.email) = lower(auth.email())
      AND c.name = OLD.contractor_name
  ) INTO is_contractor;

  IF is_contractor AND OLD.user_id IS DISTINCT FROM auth.uid() THEN
    old_locked := to_jsonb(OLD) - ARRAY[
      'wo_status',
      'wo_tasks',
      'custom_qa',
      'closeout_notes',
      'submitted_at',
      'updated_at'
    ];
    new_locked := to_jsonb(NEW) - ARRAY[
      'wo_status',
      'wo_tasks',
      'custom_qa',
      'closeout_notes',
      'submitted_at',
      'updated_at'
    ];

    IF old_locked IS DISTINCT FROM new_locked THEN
      RAISE EXCEPTION 'contractors may only update progress, task, QA, and closeout fields';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_contractor_work_order_update ON work_orders;
CREATE TRIGGER trg_enforce_contractor_work_order_update
BEFORE UPDATE ON work_orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_contractor_work_order_update();

CREATE INDEX IF NOT EXISTS idx_work_orders_external_wo_id ON work_orders(external_wo_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_source_platform ON work_orders(source_platform);
CREATE INDEX IF NOT EXISTS idx_work_orders_customer_name ON work_orders(customer_name);
CREATE INDEX IF NOT EXISTS idx_time_logs_wo_id ON time_logs(wo_id);
CREATE INDEX IF NOT EXISTS idx_signatures_wo_id ON signatures(wo_id);
