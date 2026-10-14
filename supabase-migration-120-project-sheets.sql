-- Migration 120: the live project sheet.
--
-- Fred, 2026-10-14: "I want them to get a notification like a smartsheet or
-- pdf of the site information and the tech with the time stamp plus expenses
-- or photos, notes" ... "Smartsheet is better cause we can create it from
-- scratch."
--
-- One unguessable link per project. Anyone on the project's alert list opens
-- /sheet/<token> without signing in and sees the project live: every clock-in,
-- drive, start, lunch, off site, photo and receipt, plus each site's notes,
-- answers and checklist. Every alert email carries the link.
--
-- The page reads with the service key on the server and picks its own columns
-- (no price, no tech pay), so there is no public database function to call.
-- "New link" replaces the token and the old link stops working (a PM leaves).

CREATE TABLE IF NOT EXISTS public.project_sheets (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_name text NOT NULL,
  token text NOT NULL UNIQUE
    DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_name)
);

ALTER TABLE public.project_sheets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_sheets_owner ON public.project_sheets;
CREATE POLICY project_sheets_owner ON public.project_sheets FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- The project's link, made the first time it's asked for. p_new = true gives
-- the project a new link (the old one stops working).
CREATE OR REPLACE FUNCTION public.project_sheet_token(p_project text, p_new boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v text;
BEGIN
  IF auth.uid() IS NULL OR coalesce(trim(p_project), '') = '' THEN RETURN NULL; END IF;
  IF p_new THEN
    UPDATE project_sheets
       SET token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), created_at = now()
     WHERE user_id = auth.uid() AND project_name = p_project
     RETURNING token INTO v;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;
  INSERT INTO project_sheets (user_id, project_name) VALUES (auth.uid(), p_project) ON CONFLICT DO NOTHING;
  SELECT token INTO v FROM project_sheets WHERE user_id = auth.uid() AND project_name = p_project;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.project_sheet_token(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_sheet_token(text, boolean) TO authenticated;

-- Fred, 2026-10-14: "he takes a pic, the app asked Mike 'inventory', then the
-- smartsheet gets the same on the next line with the pic". Each photo keeps
-- what it is (the tech picks it right after taking it).
ALTER TABLE public.wo_photos ADD COLUMN IF NOT EXISTS label text;

-- "Mike started traveling at 6:47 AM from 123 Main St": the street address of
-- a tap's GPS position, looked up by the server (lib/places.ts) and kept here.
ALTER TABLE public.job_day_events ADD COLUMN IF NOT EXISTS place text;

-- wf_tech_add_photo takes the label. The old 8-argument version goes, or a
-- call without a label would match both.
DROP FUNCTION IF EXISTS public.wf_tech_add_photo(text, text, text, timestamptz, double precision, double precision, double precision, text);
CREATE FUNCTION public.wf_tech_add_photo(p_wo_number text, p_path text, p_url text, p_taken_at timestamptz,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_source text, p_label text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_target jsonb := wf_tech_photo_target(p_wo_number);
  v_wo uuid;
  v_pos boolean := p_lat IS NOT NULL AND p_lng IS NOT NULL
                   AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180;
BEGIN
  IF v_target IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;
  v_wo := (v_target ->> 'wo_id')::uuid;
  IF p_path !~ ('^wo_' || v_wo::text || '/tech_[0-9a-z_-]+\.jpg$') OR right(p_url, length(p_path)) <> p_path THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_file');
  END IF;

  INSERT INTO wo_photos (user_id, wo_id, wo_number, contractor_name, path, url, taken_at, lat, lng, accuracy, source, label)
  VALUES ((v_ctx ->> 'owner_id')::uuid, v_wo, p_wo_number, v_ctx ->> 'contractor_name', p_path, p_url,
          wf_trusted_time(p_taken_at),
          CASE WHEN v_pos THEN p_lat END, CASE WHEN v_pos THEN p_lng END,
          CASE WHEN v_pos AND p_accuracy >= 0 THEN p_accuracy END,
          CASE WHEN p_source = 'library' THEN 'library' ELSE 'camera' END,
          NULLIF(left(btrim(coalesce(p_label, '')), 80), ''));

  UPDATE work_orders
     SET doc_urls = array_append(COALESCE(doc_urls, ARRAY[]::text[]), p_url), updated_at = now()
   WHERE id = v_wo AND NOT (p_url = ANY(COALESCE(doc_urls, ARRAY[]::text[])));
  RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.wf_tech_add_photo(text, text, text, timestamptz, double precision, double precision, double precision, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_add_photo(text, text, text, timestamptz, double precision, double precision, double precision, text, text) TO authenticated, service_role;
