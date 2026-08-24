-- Migration 065: add-ons on a work order's pay
--
-- Fred works Field Nation, whose pay panel is labour plus a list of line items:
-- Additional Charges add, Service Charges and Tax deduct, and a Sum at the
-- bottom. His own app had fixed fields instead, so anything that was not
-- labour or mileage had nowhere to go — materials a tech bought, a per diem,
-- tolls, a platform fee.
--
-- One list of add-ons, each adding to or deducting from the payout, so a new
-- kind of charge never needs a new column.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS pay_addons JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN work_orders.pay_addons IS
  'Line items on top of labour in the payout: materials, mileage, per diem, tolls (added) and tax, platform fees, deductions (subtracted). Shape: [{id,kind,label,amount,deduct,contractor_name}].';
