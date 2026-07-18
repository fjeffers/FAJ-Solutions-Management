-- Migration 035: Network relabeling — old label vs new label per drop
--
-- The client sites have a legacy labeling system (e.g. "29R-01/A,B,C",
-- "35/36") that is being replaced with room-number-based labels. Each drop
-- keeps its current (old) label in wall_jack_label; target_label is the new
-- label it should get. jacks lists the jack positions on the wall plate
-- (usually A,B,C). Each site carries a label_scheme template used to
-- generate target labels: {room} = room number, {jack} = one row per jack
-- letter, {jacks} = the letters joined. Default "{room}-{jack}" produces
-- "2153-A, 2153-B, 2153-C".

ALTER TABLE network_sites
  ADD COLUMN IF NOT EXISTS label_scheme TEXT NOT NULL DEFAULT '{room}-{jack}';

ALTER TABLE network_drops
  ADD COLUMN IF NOT EXISTS item_type    TEXT,
  ADD COLUMN IF NOT EXISTS jacks        TEXT DEFAULT 'A,B,C',
  ADD COLUMN IF NOT EXISTS target_label TEXT;
