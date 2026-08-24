-- Migration 063: what the CLIENT is billed for travel and materials
--
-- The work order had nowhere to record travel or materials as REVENUE. The only
-- fields for either — mileage_logs and materials_used — are payout concepts:
-- money owed to the tech who drove or bought. So a $168.70 visit became a work
-- order whose client price was recalculated as hours x rate = $110 on the next
-- save, silently deleting $58.70 of revenue; and putting the travel into
-- mileage_logs instead turned that revenue into an expense and showed the job at
-- a loss.
--
-- These three are the client side. mileage_logs and materials_used stay the
-- payout side. Both are set per job, because whether a tech is reimbursed for
-- travel varies by job.
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS billable_travel    NUMERIC,
  ADD COLUMN IF NOT EXISTS billable_materials NUMERIC,
  ADD COLUMN IF NOT EXISTS billable_other     NUMERIC;

COMMENT ON COLUMN work_orders.billable_travel IS
  'Travel charged to the client. Revenue. Not the tech mileage reimbursement, which is mileage_logs.';
COMMENT ON COLUMN work_orders.billable_materials IS
  'Materials charged to the client. Revenue. Not materials_used, which is what the job consumed.';
