-- Migration 068: camera schedule + documentation on a survey
--
-- A survey was scope lines and prose. The two things actually produced on a
-- camera walk-through had nowhere to live:
--
--   1. The camera schedule — a numbered table of every camera position, its
--      location, indoor/outdoor, type (dome / PTZ / panoramic) and cable run.
--      This is the document the whole job is priced from: the count drives the
--      switch port count, the materials estimate and the NVR channel count.
--      Renumbering matters — insert a head-end camera at position 1 and every
--      other camera shifts down, so positions are stored explicitly and
--      rewritten on reorder rather than inferred from array index at render.
--
--   2. Documentation — the photos taken on site, plus the existing floor plans,
--      spec sheets and vendor quotes that back the estimate up. These were
--      living in email.
--
-- Both are JSONB arrays on the survey, matching how work_orders already carries
-- wo_tasks/materials_used and how network_sites carries floor_plan.
--
-- surveys.photos (migration 066) stays as-is: a plain image gallery from the
-- walk. `documents` is the wider set — anything with a file behind it.

ALTER TABLE surveys ADD COLUMN IF NOT EXISTS cameras   JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::JSONB;

-- Head-end / infrastructure notes that come out of the same walk-through and
-- feed the estimate: existing rack, patch panel, available rack units, PoE.
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS head_end_notes  TEXT;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS rack_space      TEXT;   -- e.g. '9-12U'
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS switch_notes    TEXT;   -- PoE switch make/model or 'sourcing'
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS access_notes    TEXT;   -- occupied?, permits, attic/crawlspace

-- ── Document storage ────────────────────────────────────────────────────────
-- Public-read, authenticated-write: same shape as the network-photos bucket
-- (migration 037). Public read is what lets a plan image or site photo render
-- inline on the client-facing quote page without a login. Anything genuinely
-- private does not belong in this bucket.
INSERT INTO storage.buckets (id, name, public)
  VALUES ('survey-docs', 'survey-docs', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated upload survey docs" ON storage.objects;
CREATE POLICY "Authenticated upload survey docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'survey-docs');

DROP POLICY IF EXISTS "Authenticated update survey docs" ON storage.objects;
CREATE POLICY "Authenticated update survey docs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'survey-docs');

DROP POLICY IF EXISTS "Authenticated delete survey docs" ON storage.objects;
CREATE POLICY "Authenticated delete survey docs"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'survey-docs');

DROP POLICY IF EXISTS "Public read survey docs" ON storage.objects;
CREATE POLICY "Public read survey docs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'survey-docs');
