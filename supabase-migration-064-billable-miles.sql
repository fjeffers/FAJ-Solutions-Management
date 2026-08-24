-- Migration 064: the miles behind the client's travel charge
--
-- billable_travel (063) records the AMOUNT the client is billed for travel, but
-- not the distance it came from — so a work order could say "$58.70 travel"
-- with no way to check it or to recalculate when a rate changes. The Site Log
-- has kept both since day one; the work order should too.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS billable_miles NUMERIC;

COMMENT ON COLUMN work_orders.billable_miles IS
  'Round-trip miles behind billable_travel. Client side; the tech reimbursement distance lives in mileage_logs.';
