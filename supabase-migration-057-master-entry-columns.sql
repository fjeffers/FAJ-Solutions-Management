-- Migration 057: line up site_visits with the Invoice Tracker's Master Entry
--
-- Fred works the year in FAJ_Solutions_Invoice_Tracker_2026_master_auto.xlsx.
-- Its "Master Entry" sheet is 20 columns and the Site Sheet only covered 14 of
-- them, so the app and the spreadsheet disagreed on shape — you could not read
-- one against the other, let alone paste between them.
--
-- Four fields were genuinely missing. Scope of Work is not added here: it maps
-- onto the existing client_summary, which already means "the work description
-- the client sees" and would otherwise be duplicated.

ALTER TABLE site_visits
  -- Master Entry M: what was fitted or supplied.
  ADD COLUMN IF NOT EXISTS materials_description TEXT,
  -- Master Entry N: cost of those materials, billed on.
  ADD COLUMN IF NOT EXISTS materials_cost        NUMERIC,
  -- Master Entry O: anything else chargeable that is not labor, mileage or
  -- materials — permits, parking, equipment rental.
  ADD COLUMN IF NOT EXISTS other_charges         NUMERIC,
  -- Master Entry T: free-text tail, kept so a pasted row round-trips whole.
  ADD COLUMN IF NOT EXISTS additional_details    TEXT;

COMMENT ON COLUMN site_visits.materials_description IS
  'Master Entry column M. Free text — what was supplied on this visit.';
COMMENT ON COLUMN site_visits.materials_cost IS
  'Master Entry column N. Billed to the client; feeds Line Total.';
COMMENT ON COLUMN site_visits.other_charges IS
  'Master Entry column O. Non-labor, non-mileage, non-materials charges; feeds Line Total.';
COMMENT ON COLUMN site_visits.additional_details IS
  'Master Entry column T.';
