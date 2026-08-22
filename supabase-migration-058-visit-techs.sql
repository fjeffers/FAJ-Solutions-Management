-- Migration 058: more than one tech on a site visit
--
-- site_visits carried a single contractor_id, so a two-man job recorded one
-- name and lost the other. Fred wants the crew tracked whatever the job is.
--
-- This is a RECORD of who was on site. It deliberately does not touch money:
-- billing still comes from hours x rate, and tech payouts still run through
-- work_orders.contractor_pay. Adding a second tech does not change what the
-- client is charged.
--
-- contractor_id stays, holding the lead tech (the first of tech_ids), so
-- everything already reading it keeps working.

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS tech_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN site_visits.tech_ids IS
  'Every tech on site, in order; the first is the lead. contractor_id mirrors the lead for backwards compatibility.';

-- Bring the existing single assignments across so nothing is lost.
UPDATE site_visits
   SET tech_ids = ARRAY[contractor_id]
 WHERE contractor_id IS NOT NULL
   AND cardinality(tech_ids) = 0;

-- "Which visits was this tech on?" is the query this has to be fast for.
CREATE INDEX IF NOT EXISTS idx_site_visits_tech_ids
  ON site_visits USING GIN (tech_ids);
