-- Migration 029: per-contractor pay split on multi-tech work orders
-- contractor_pay maps contractor name -> dollar amount for that tech on this WO,
-- e.g. {"Jere Jones": 250, "Darnell Williams": 150}. Null means no split defined:
-- single-tech WOs don't need one, and legacy multi-tech WOs fall back to the
-- primary contractor carrying the full total (previous behavior).

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS contractor_pay JSONB;
