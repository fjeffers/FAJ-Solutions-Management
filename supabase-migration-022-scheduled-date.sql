-- Migration 022: scheduled_date on work_orders
-- Supports the Scheduling Dashboard's drag-drop calendar. Nullable, no backfill —
-- existing rows show up in the "unscheduled" pool until assigned a date.

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS scheduled_date DATE;
