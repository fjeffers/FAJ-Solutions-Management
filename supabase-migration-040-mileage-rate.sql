-- Migration 040: customer mileage rate for auto travel charges
--
-- Site Log auto-mileage now also computes the travel charge billed to the
-- customer: travel_charge = round_trip_miles x mileage_rate. Default 0.70
-- matches the app's existing per-mile default in work order mileage logs.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS mileage_rate NUMERIC NOT NULL DEFAULT 0.70;
