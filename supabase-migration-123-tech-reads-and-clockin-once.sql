-- Migration 123: the tech's messages get read, and Clock in counts once.
--
-- Fred, 2026-10-14, testing the live sheet: "the information is only one
-- way ... I sent a message back without getting anything as a tech" and
-- "needs to alert them, not just come through". The app now pops the message
-- up on the tech's screen; it needs to know which ones they've seen.
--
-- Also from that test: Clock in was tapped 7 times in 2 minutes (the button
-- didn't move on; fixed in lib/project-day.ts) and every tap alerted the PM.
-- A second Clock in on the same job within 10 minutes is now ignored.

-- The thread says which messages the tech has seen.
CREATE OR REPLACE FUNCTION public.tech_messages(p_wo_number text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo work_orders%ROWTYPE; v_name text := tech_ctx()->>'contractor_name'; v_out jsonb;
BEGIN
  IF p_wo_number IS NULL THEN RETURN NULL; END IF;
  v_wo := wf_tech_own_job(p_wo_number);
  IF v_wo.id IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'sender_name', m.sender_name, 'sender_role', m.sender_role, 'content', m.content,
      'created_at', m.created_at, 'kind', m.kind, 'to_name', m.to_name, 'on_sheet', m.on_sheet,
      'reason', m.reason, 'parent_id', m.parent_id, 'resolved_at', m.resolved_at, 'row_ref', m.row_ref,
      'mine', m.sender_role = 'contractor' AND m.sender_name = v_name,
      'for_me', m.to_name IS NULL OR m.to_name = v_name,
      'read', m.read_at IS NOT NULL)
    ORDER BY m.created_at ASC) INTO v_out
  FROM work_order_messages m
  WHERE m.work_order_id = p_wo_number AND m.user_id = v_wo.user_id;
  RETURN COALESCE(v_out, '[]'::jsonb);
END $$;

-- The tech has seen this job's messages meant for them.
CREATE OR REPLACE FUNCTION public.wf_tech_mark_read(p_wo_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo work_orders%ROWTYPE; v_name text := tech_ctx()->>'contractor_name'; v_n integer;
BEGIN
  v_wo := wf_tech_own_job(p_wo_number);
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_your_job'); END IF;
  UPDATE work_order_messages SET read_at = now()
   WHERE user_id = v_wo.user_id AND work_order_id = v_wo.wo_number AND sender_role <> 'contractor'
     AND read_at IS NULL AND (to_name IS NULL OR to_name = v_name);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'read', v_n);
END $$;
REVOKE ALL ON FUNCTION public.wf_tech_mark_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_mark_read(text) TO authenticated;

-- Clock in once: a second one on the same job within 10 minutes is a double tap.
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
    IF v_dest NOT IN ('site', 'hotel', 'home', 'next_site')
       OR (NULLIF(p_origin, '') IS NOT NULL AND p_origin NOT IN ('home', 'hotel', 'site', 'other')) THEN
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
