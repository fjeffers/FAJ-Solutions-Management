-- Migration 032: mileage logs on work orders
-- Array of { id, contractor_name, miles, rate, note } recorded at closeout.
-- rate is dollars per mile (editable per row; UI defaults to 0.70).

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS mileage_logs JSONB NOT NULL DEFAULT '[]';
