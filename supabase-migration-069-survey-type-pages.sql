-- Migration 069: survey type, and the drop schedule that goes with cabling work
--
-- A survey was one long form that assumed every job was a camera job. It isn't:
-- a camera walk-through counts mounts, covers and cable runs, while a cabling
-- walk-through counts drops, jacks, cable type and where each one terminates on
-- the patch panel. Same building, different questions.
--
-- `survey_type` is what the app branches on. It drives which page 2 the
-- surveyor gets — the camera schedule or the drop schedule — so nobody is asked
-- for a camera resolution on a desk-cabling job.
--
-- The schedules stay as separate JSONB arrays rather than one union shape. A
-- camera row and a drop row genuinely differ (mount/cover/resolution vs
-- jacks/cable type/termination), and a shared shape half-full of nulls is how
-- forms start lying about what was surveyed.

ALTER TABLE surveys ADD COLUMN IF NOT EXISTS survey_type TEXT NOT NULL DEFAULT 'camera';

-- Drop schedule for cabling and network surveys:
--   [{ id, position, location, jack_count, cable_type, run_length,
--      termination, mount, notes, photos[] }]
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS cable_drops JSONB NOT NULL DEFAULT '[]'::JSONB;

-- Which wizard page the surveyor last had open, so reopening a half-finished
-- survey in the field resumes where they stopped instead of at page 1.
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS last_page SMALLINT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_surveys_type ON surveys (user_id, survey_type);
