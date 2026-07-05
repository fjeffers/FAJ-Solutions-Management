-- Migration 023: site_lat / site_lng on work_orders
-- Supports the Dispatch Map. Geocoded once client-side on save and persisted here,
-- rather than re-geocoding on every map load. Nullable, no backfill.

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS site_lat DOUBLE PRECISION;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS site_lng DOUBLE PRECISION;
