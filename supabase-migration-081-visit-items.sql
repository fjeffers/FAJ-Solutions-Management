-- 081: a visit can carry more than one material and more than one drive.
--
-- A site visit had room for exactly one of each: materials_description +
-- materials_cost, and miles + travel_charge. A two-day job with three parts
-- runs and a box of faceplates had to be squashed into one line, so the detail
-- that justifies the bill was lost before it reached the client.
--
-- These are the SAME shapes work orders already use (MaterialUsed, MileageLog),
-- deliberately, so converting a visit carries the rows across unchanged instead
-- of flattening them again on the way.
--
-- The old single columns are kept and maintained as the totals of the new
-- arrays. The statement, the Excel export and the invoice builder all read
-- them, and nothing about those needs to change.

ALTER TABLE public.site_visits
  ADD COLUMN IF NOT EXISTS materials_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mileage_logs   jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Carry what is already recorded into the new arrays, so no visit starts empty
-- and no money changes. A materials cost with no description still becomes a
-- row, named the way the app names it elsewhere.
UPDATE public.site_visits
   SET materials_used = jsonb_build_array(
         jsonb_build_object(
           'id', 'sv-materials',
           'material_id', NULL,
           'name', COALESCE(NULLIF(btrim(materials_description), ''), 'Materials'),
           'quantity', 1,
           'unit_cost', materials_cost,
           'client_pays', false
         ))
 WHERE materials_used = '[]'::jsonb
   AND COALESCE(materials_cost, 0) <> 0;

-- Mileage: rate is derived where both numbers exist, otherwise the $0.50/mile
-- the business actually uses. A travel charge with no miles is left alone —
-- it is a flat charge, not a drive, and inventing a mileage row would misstate
-- what happened.
UPDATE public.site_visits
   SET mileage_logs = jsonb_build_array(
         jsonb_build_object(
           'id', 'sv-mileage',
           'contractor_name', '',
           'miles', miles,
           'rate', CASE WHEN COALESCE(travel_charge,0) <> 0 AND miles > 0
                        THEN round((travel_charge / miles)::numeric, 4)
                        ELSE 0.50 END,
           'note', NULL
         ))
 WHERE mileage_logs = '[]'::jsonb
   AND COALESCE(miles, 0) > 0;
