-- Migration 045: multi-day / multi-time work sessions on a site visit
--
-- Jobs like Glenolden run "June 4th 20:15-23:45, then June 5th 10:00-13:15".
-- sessions holds an array of {in, out} ISO timestamps; hours totals every
-- completed session. time_in/time_out keep mirroring first-in / last-out so
-- the check-in timer and card display stay simple.

ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS sessions JSONB NOT NULL DEFAULT '[]';
