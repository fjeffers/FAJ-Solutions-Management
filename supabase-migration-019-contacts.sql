-- Migration 019: add contacts JSONB array to work_orders
-- Each entry: { id, label, name, phone, email }

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS contacts JSONB DEFAULT '[]'::jsonb;
