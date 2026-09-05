-- Migration 084: material kits — a saved "recipe" of materials
--
-- The same job types come round again and again: a camera drop, an AP install,
-- a Starlink mount. Every time, the same handful of parts get typed in by hand
-- at closeout, and the same handful get guessed at when a quote goes out.
--
-- A kit is that list, saved once and named. Pick it on a job's Closeout tab and
-- every line lands at once; pick it in a quote and the materials are priced in
-- before the work starts instead of discovered after.
--
-- items is the SAME shape a work order's materials_used rows use, minus the
-- money flags (client_pays / reimburse), which belong to a job and not to a
-- template. material_id links to the inventory row so a kit follows the current
-- name and cost; null means an item bought for the job that isn't stocked.
--
--   [{ id, material_id, name, quantity, unit_cost }]
--
-- A kit NEVER moves stock on its own. Inventory only changes when the work
-- order it was added to is saved, exactly as it does for a hand-typed row.

CREATE TABLE IF NOT EXISTS material_kits (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  items       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Two kits called "Camera drop" is a coin toss every time you pick one.
  UNIQUE (user_id, name)
);

ALTER TABLE material_kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own material kits"
  ON material_kits FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS material_kits_user_idx ON material_kits (user_id, name);
