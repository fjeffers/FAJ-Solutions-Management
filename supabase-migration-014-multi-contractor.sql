-- Migration 014: Multi-contractor support
-- Adds contractor_names (text array) to work_orders so a WO can list multiple techs.
-- contractor_name (singular) is preserved as the "primary" contractor for backward compat.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS contractor_names text[];
