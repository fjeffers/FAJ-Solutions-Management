-- Migration 100: GPS on the tech portal, and stamped job photos
--
-- Fred, 2026-10-02: "I want GPS on the portal and time and date and GPS
-- location on the pictures".
--
--   contractor_time_logs   gains where the tech was when they clocked in and
--                          out (lat, lng, accuracy in metres).
--   wf_tech_clock_gps()    wf_tech_clock_at (migration-098) plus the position.
--                          The tap time is trusted up to 48h back, as before,
--                          so a clock-in made with no signal keeps its time AND
--                          its place. The first clock-in with a position also
--                          fills "arrived", which the Dispatch Map shows.
--   wo_photos              one row per photo a tech takes in the portal: the
--                          job, who, when, where. The picture itself also has
--                          the date, time and GPS printed on it, and its link is
--                          added to the job's documents (doc_urls) so it shows
--                          wherever job photos already show.
--   wf_tech_photo_target() the job a tech may add a photo to (their own live
--                          job only) — the upload route asks this first.
--   wf_tech_add_photo()    record an uploaded photo on the tech's own job.
--   wf_tech_job_photos()   the photos on a job, for the techs on it.
-- Owner reads wo_photos through RLS; nobody writes it except these functions.

ALTER TABLE public.contractor_time_logs
  ADD COLUMN IF NOT EXISTS checked_in_lat       double precision,
  ADD COLUMN IF NOT EXISTS checked_in_lng       double precision,
  ADD COLUMN IF NOT EXISTS checked_in_accuracy  double precision,
  ADD COLUMN IF NOT EXISTS checked_out_lat      double precision,
  ADD COLUMN IF NOT EXISTS checked_out_lng      double precision,
  ADD COLUMN IF NOT EXISTS checked_out_accuracy double precision;

CREATE OR REPLACE FUNCTION public.wf_tech_clock_gps(
  p_wo_number text, p_action text, p_at timestamptz,
  p_lat double precision, p_lng double precision, p_accuracy double precision)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_name text;
  v_owner uuid;
  v_wo work_orders%ROWTYPE;
  v_log_id uuid;
  v_at timestamptz := wf_trusted_time(p_at);
  v_pos boolean := p_lat IS NOT NULL AND p_lng IS NOT NULL
                   AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180;
  v_acc double precision := CASE WHEN p_accuracy >= 0 THEN p_accuracy END;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  IF p_action NOT IN ('in', 'out') THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_action'); END IF;
  v_name := v_ctx ->> 'contractor_name';
  v_owner := (v_ctx ->> 'owner_id')::uuid;

  SELECT * INTO v_wo FROM work_orders w
   WHERE w.wo_number = p_wo_number AND w.user_id = v_owner AND w.archived_at IS NULL
     AND w.wo_status NOT IN ('Approved', 'Paid', 'Cancelled')
     AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name)
   LIMIT 1;
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;

  SELECT id INTO v_log_id FROM contractor_time_logs WHERE wo_id = v_wo.id AND contractor_name = v_name LIMIT 1;
  IF v_log_id IS NULL THEN
    INSERT INTO contractor_time_logs (wo_id, wo_number, contractor_name)
    VALUES (v_wo.id, p_wo_number, v_name) RETURNING id INTO v_log_id;
  END IF;

  IF p_action = 'in' THEN
    UPDATE contractor_time_logs
       SET checked_in_at = v_at, checked_out_at = NULL,
           checked_in_lat = CASE WHEN v_pos THEN p_lat END,
           checked_in_lng = CASE WHEN v_pos THEN p_lng END,
           checked_in_accuracy = CASE WHEN v_pos THEN v_acc END,
           checked_out_lat = NULL, checked_out_lng = NULL, checked_out_accuracy = NULL,
           arrived_at  = CASE WHEN arrived_at IS NULL AND v_pos THEN v_at ELSE arrived_at END,
           arrived_lat = CASE WHEN arrived_at IS NULL AND v_pos THEN p_lat ELSE arrived_lat END,
           arrived_lng = CASE WHEN arrived_at IS NULL AND v_pos THEN p_lng ELSE arrived_lng END,
           updated_at = now()
     WHERE id = v_log_id;
    UPDATE work_orders SET wo_status = 'In Progress', updated_at = now()
     WHERE id = v_wo.id AND wo_status IN ('Open', 'Assigned');
  ELSE
    UPDATE contractor_time_logs
       SET checked_out_at = GREATEST(v_at, COALESCE(checked_in_at, v_at)),
           checked_out_lat = CASE WHEN v_pos THEN p_lat END,
           checked_out_lng = CASE WHEN v_pos THEN p_lng END,
           checked_out_accuracy = CASE WHEN v_pos THEN v_acc END,
           updated_at = now()
     WHERE id = v_log_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'reason', p_action, 'at', v_at, 'gps', v_pos);
END;
$$;

CREATE TABLE IF NOT EXISTS public.wo_photos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  wo_id           uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  wo_number       text NOT NULL,
  contractor_name text,
  path            text NOT NULL,
  url             text NOT NULL,
  taken_at        timestamptz NOT NULL,
  lat             double precision,
  lng             double precision,
  accuracy        double precision,
  source          text NOT NULL DEFAULT 'camera' CHECK (source IN ('camera', 'library')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wo_photos_wo_idx ON public.wo_photos (wo_id, taken_at);
ALTER TABLE public.wo_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wo_photos_owner_read ON public.wo_photos;
CREATE POLICY wo_photos_owner_read ON public.wo_photos FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.wo_photos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.wo_photos FROM authenticated;

-- The tech's own live job, or nothing.
CREATE OR REPLACE FUNCTION public.wf_tech_photo_target(p_wo_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_name text;
  v_id uuid;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;
  v_name := v_ctx ->> 'contractor_name';
  SELECT w.id INTO v_id FROM work_orders w
   WHERE w.wo_number = p_wo_number AND w.user_id = (v_ctx ->> 'owner_id')::uuid AND w.archived_at IS NULL
     AND COALESCE(w.wo_status, 'Open') NOT IN ('Approved', 'Paid', 'Cancelled')
     AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name)
   LIMIT 1;
  RETURN CASE WHEN v_id IS NULL THEN NULL ELSE jsonb_build_object('wo_id', v_id) END;
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_tech_add_photo(
  p_wo_number text, p_path text, p_url text, p_taken_at timestamptz,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_target jsonb := wf_tech_photo_target(p_wo_number);
  v_wo uuid;
  v_pos boolean := p_lat IS NOT NULL AND p_lng IS NOT NULL
                   AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180;
BEGIN
  IF v_target IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;
  v_wo := (v_target ->> 'wo_id')::uuid;
  -- Only a file this job's upload route just stored: wo_<id>/tech_<…>.jpg,
  -- and a link that points at exactly that file.
  IF p_path !~ ('^wo_' || v_wo::text || '/tech_[0-9a-z_-]+\.jpg$') OR right(p_url, length(p_path)) <> p_path THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_file');
  END IF;

  INSERT INTO wo_photos (user_id, wo_id, wo_number, contractor_name, path, url, taken_at, lat, lng, accuracy, source)
  VALUES ((v_ctx ->> 'owner_id')::uuid, v_wo, p_wo_number, v_ctx ->> 'contractor_name', p_path, p_url,
          wf_trusted_time(p_taken_at),
          CASE WHEN v_pos THEN p_lat END, CASE WHEN v_pos THEN p_lng END,
          CASE WHEN v_pos AND p_accuracy >= 0 THEN p_accuracy END,
          CASE WHEN p_source = 'library' THEN 'library' ELSE 'camera' END);

  UPDATE work_orders
     SET doc_urls = array_append(COALESCE(doc_urls, ARRAY[]::text[]), p_url), updated_at = now()
   WHERE id = v_wo AND NOT (p_url = ANY(COALESCE(doc_urls, ARRAY[]::text[])));
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_tech_job_photos(p_wo_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_name text;
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_name := v_ctx ->> 'contractor_name';
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'url', p.url, 'taken_at', p.taken_at, 'lat', p.lat, 'lng', p.lng,
                                        'by', p.contractor_name) ORDER BY p.taken_at DESC)
      FROM wo_photos p JOIN work_orders w ON w.id = p.wo_id
     WHERE p.wo_number = p_wo_number AND w.user_id = (v_ctx ->> 'owner_id')::uuid
       AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
            OR w.lead_contractor_name = v_name)
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.wf_tech_clock_gps(text, text, timestamptz, double precision, double precision, double precision),
  public.wf_tech_photo_target(text),
  public.wf_tech_add_photo(text, text, text, timestamptz, double precision, double precision, double precision, text),
  public.wf_tech_job_photos(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_clock_gps(text, text, timestamptz, double precision, double precision, double precision),
  public.wf_tech_photo_target(text),
  public.wf_tech_add_photo(text, text, text, timestamptz, double precision, double precision, double precision, text),
  public.wf_tech_job_photos(text) TO authenticated;
