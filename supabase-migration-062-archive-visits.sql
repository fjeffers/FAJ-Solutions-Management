-- Migration 062: archiving a site visit
--
-- Fred's working rhythm is: mark a few visits as a work order, invoice them,
-- then get them off the board. Without somewhere to put a finished visit the
-- Site Log only ever grows, so the list stops being a to-do list and the money
-- tiles stop meaning "outstanding".
--
-- Archived is a timestamp rather than a boolean so it also records WHEN a visit
-- was cleared, and so nothing is ever deleted — an archived visit still counts
-- on a statement for the period it belongs to.
ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS site_visits_archived_idx
  ON site_visits (user_id, archived_at);
