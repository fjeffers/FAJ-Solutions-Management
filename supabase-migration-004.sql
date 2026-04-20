-- ================================================================
-- Migration 004: Contractor Portal
-- Run in Supabase SQL Editor for project: faj-payment-solutions
-- ================================================================

-- 1. Deliverable submissions table
CREATE TABLE IF NOT EXISTS deliverable_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id           uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  wo_number       text NOT NULL,
  contractor_name text NOT NULL,
  notes           text,
  submitted_at    timestamptz DEFAULT now()
);

ALTER TABLE deliverable_submissions ENABLE ROW LEVEL SECURITY;

-- Contractors can insert their own submissions
CREATE POLICY "contractors_insert_deliverables" ON deliverable_submissions
FOR INSERT WITH CHECK (
  contractor_name IN (
    SELECT name FROM contractors WHERE email = auth.email()
  )
);

-- Contractors can view their own submissions
CREATE POLICY "contractors_view_deliverables" ON deliverable_submissions
FOR SELECT USING (
  contractor_name IN (
    SELECT name FROM contractors WHERE email = auth.email()
  )
);

-- Fred (admin) can view all deliverables for his work orders
CREATE POLICY "admin_manage_deliverables" ON deliverable_submissions
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM work_orders wo
    WHERE wo.id = wo_id AND wo.user_id = auth.uid()
  )
);

-- 2. Contractors can view their own work orders (RLS alongside admin policy)
CREATE POLICY "contractors_view_own_workorders" ON work_orders
FOR SELECT USING (
  contractor_name IN (
    SELECT name FROM contractors WHERE email = auth.email()
  )
);

-- 3. Contractors can update wo_status on their own work orders
CREATE POLICY "contractors_update_wo_status" ON work_orders
FOR UPDATE USING (
  contractor_name IN (
    SELECT name FROM contractors WHERE email = auth.email()
  )
) WITH CHECK (
  contractor_name IN (
    SELECT name FROM contractors WHERE email = auth.email()
  )
);

-- 4. Contractors can view their own payments
CREATE POLICY "contractors_view_own_payments" ON payments
FOR SELECT USING (
  contractor_name IN (
    SELECT name FROM contractors WHERE email = auth.email()
  )
);

-- 5. Contractors can view their own contractor record
CREATE POLICY "contractors_view_own_record" ON contractors
FOR SELECT USING (
  email = auth.email()
);
