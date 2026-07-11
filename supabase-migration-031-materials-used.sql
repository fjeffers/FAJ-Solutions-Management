-- Migration 031: materials used at closeout
-- Array of { id, material_id, name, quantity, unit_cost } recorded when closing
-- a work order. material_id links to the materials inventory table (stock is
-- decremented app-side on save); material_id null = extra item bought for the
-- job that wasn't in inventory.

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS materials_used JSONB NOT NULL DEFAULT '[]';
