-- Migration 144: which end of the drive each of the tech's odometer photos is (2026-10-29).
--
-- Fred, 2026-10-29: "Tech are complaining the take pictures a day it takes the
-- milage but at the end it [shows] different figures". The phone showed each
-- drive's GPS miles under the odometer photos the tech had just taken. It now
-- shows the drive's miles from its own two photos, paired the way the office's
-- bill pairs them (lib/weekly-bill.ts matchOdometer), which needs to know a
-- start photo from an end photo. wf_tech_jobs' my_odometer sent only the time
-- and the reading; it now sends the moment too. Nothing else changes.

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.wf_tech_jobs()'::regprocedure) INTO def;
  IF position('''reading'', o.reading, ''moment'', o.moment' in def) = 0 THEN
    def := replace(def, 'jsonb_build_object(''at'', o.at, ''reading'', o.reading)',
                        'jsonb_build_object(''at'', o.at, ''reading'', o.reading, ''moment'', o.moment)');
    IF position('''reading'', o.reading, ''moment'', o.moment' in def) = 0 THEN
      RAISE EXCEPTION 'wf_tech_jobs: my_odometer was not where expected';
    END IF;
    EXECUTE def;
  END IF;
END $$;
