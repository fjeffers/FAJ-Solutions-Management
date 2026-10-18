-- Migration 132: a materials pickup is a place a tech can drive to (2026-10-18).
--
-- Fred, asked whether "Traveling to" should also offer a supply house or store:
-- "materials is fine". Like the fuel stop (migration 131): a drive can go to
-- 'materials' and the next one leaves from it; arriving there keeps the day
-- going (no sign-out, no time on site).

ALTER TABLE public.job_day_events DROP CONSTRAINT IF EXISTS job_day_events_dest_check;
ALTER TABLE public.job_day_events ADD CONSTRAINT job_day_events_dest_check
  CHECK (dest = ANY (ARRAY['site', 'hotel', 'home', 'next_site', 'fuel', 'materials']::text[]));
ALTER TABLE public.job_day_events DROP CONSTRAINT IF EXISTS job_day_events_origin_check;
ALTER TABLE public.job_day_events ADD CONSTRAINT job_day_events_origin_check
  CHECK (origin = ANY (ARRAY['home', 'hotel', 'site', 'other', 'fuel', 'materials']::text[]));

-- The same function as migration 131, with 'materials' in both lists.
CREATE OR REPLACE FUNCTION public.wf_tech_day_event(p_wo_number text, p_kind text, p_at timestamp with time zone, p_lat double precision, p_lng double precision, p_accuracy double precision, p_origin text, p_dest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_name  text;
  v_owner uuid;
  v_wo    uuid;
  v_at    timestamptz := wf_trusted_time(p_at);
  v_pos   boolean := p_lat IS NOT NULL AND p_lng IS NOT NULL
                     AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
                     AND NOT (p_lat = 0 AND p_lng = 0);
  v_acc   double precision := CASE WHEN p_accuracy >= 0 THEN p_accuracy END;
  v_last  job_day_events%ROWTYPE;
  v_miles numeric;
  v_dest  text;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  IF p_kind NOT IN ('day_start', 'travel_start', 'travel_end', 'lunch_start', 'lunch_end') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_action');
  END IF;
  v_name := v_ctx ->> 'contractor_name';
  v_owner := (v_ctx ->> 'owner_id')::uuid;

  SELECT w.id INTO v_wo FROM work_orders w
   WHERE w.wo_number = p_wo_number AND w.user_id = v_owner AND w.archived_at IS NULL
     AND COALESCE(w.wo_status, 'Open') NOT IN ('Approved', 'Paid', 'Cancelled')
     AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name)
   LIMIT 1;
  IF v_wo IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;

  IF p_kind = 'day_start' AND EXISTS (
    SELECT 1 FROM job_day_events WHERE wo_id = v_wo AND contractor_name = v_name AND kind = 'day_start'
       AND at BETWEEN v_at - interval '10 minutes' AND v_at + interval '10 minutes') THEN
    RETURN jsonb_build_object('ok', true, 'at', v_at, 'already', true);
  END IF;

  IF p_kind = 'travel_start' THEN
    v_dest := COALESCE(NULLIF(p_dest, ''), 'site');
    IF v_dest NOT IN ('site', 'hotel', 'home', 'next_site', 'fuel', 'materials')
       OR (NULLIF(p_origin, '') IS NOT NULL AND p_origin NOT IN ('home', 'hotel', 'site', 'other', 'fuel', 'materials')) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_action');
    END IF;
  END IF;

  IF p_kind = 'travel_end' AND v_pos THEN
    SELECT * INTO v_last FROM job_day_events
     WHERE wo_id = v_wo AND contractor_name = v_name AND kind IN ('travel_start', 'travel_end') AND at <= v_at
     ORDER BY at DESC LIMIT 1;
    IF v_last.kind = 'travel_start' AND v_last.lat IS NOT NULL AND v_last.lng IS NOT NULL THEN
      v_miles := round((1.2 * 3958.8 * 2 * asin(sqrt(
        power(sin(radians(p_lat - v_last.lat) / 2), 2)
        + cos(radians(v_last.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_last.lng) / 2), 2))))::numeric, 1);
      IF v_miles >= 3000 THEN v_miles := NULL; END IF;
    END IF;
  END IF;

  INSERT INTO job_day_events (user_id, wo_id, wo_number, contractor_name, kind, at, lat, lng, accuracy,
                              origin, dest, miles, miles_from_gps)
  VALUES (v_owner, v_wo, p_wo_number, v_name, p_kind, v_at,
          CASE WHEN v_pos THEN p_lat END, CASE WHEN v_pos THEN p_lng END, CASE WHEN v_pos THEN v_acc END,
          CASE WHEN p_kind = 'travel_start' THEN NULLIF(p_origin, '') END,
          CASE WHEN p_kind = 'travel_start' THEN v_dest END,
          v_miles, v_miles IS NOT NULL)
  ON CONFLICT (wo_id, contractor_name, kind, at) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'at', v_at, 'gps', v_pos, 'miles', v_miles);
END;
$function$;
