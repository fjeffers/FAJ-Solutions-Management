-- Migration 105: job closeout and "suggest another time" in the tech portal
--
-- Fred, 2026-10-04: "can workflow update to what you see" (the Primio WorkFlow
-- app on GitHub) — "everything", and "No pay for techs".
--
--   work_orders.closeout       What the tech handed over at the end of the job:
--                              { done: [deliverable labels ticked off],
--                                delays: [{ id, reason, start, end }],
--                                signoff: { name, signed_at } | null }
--                              The deliverable list itself comes from the job
--                              type (kiosk / survey / everything else, in
--                              lib/closeout.ts), so only the ticks are stored.
--   work_orders.time_requests  A tech offered a job can ask for another date and
--                              time with a note: { "<tech name>": { date, time,
--                              note, at, state } }, state waiting / accepted /
--                              kept. Never a pay counter-offer — techs do not
--                              see or propose money.
--
--   wf_tech_jobs()             also returns closeout and the tech's own time
--                              request. Still no money.
--   wf_tech_closeout(...)      one change at a time (tick, add or remove a
--                              delay, sign, clear the signature), applied on the
--                              server so two techs on one job never overwrite
--                              each other's ticks.
--   wf_tech_request_time(...)  ask for another time, or take the ask back.
--
-- The office reads and answers both through its own work order rows (owner
-- RLS), like the rest of the WorkFlow screen.

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS closeout jsonb;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS time_requests jsonb;

CREATE OR REPLACE FUNCTION public.wf_tech_jobs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_name  text;
  v_owner uuid;
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_name  := v_ctx ->> 'contractor_name';
  v_owner := (v_ctx ->> 'owner_id')::uuid;
  RETURN COALESCE((
    SELECT jsonb_agg(j ORDER BY sort_date NULLS LAST, wo_number)
    FROM (
      SELECT jsonb_build_object(
        'id', w.id, 'wo_number', w.wo_number, 'title', w.title, 'description', w.description,
        'scope_of_work', w.scope_of_work, 'service_type', w.service_type, 'wo_status', w.wo_status,
        'priority', w.priority, 'customer_name', COALESCE(NULLIF(w.customer_name, ''), w.buyer_company),
        'project_name', w.project_name,
        'site_name', w.site_name, 'site_address', w.site_address, 'site_city', w.site_city,
        'site_state', w.site_state, 'site_zip', w.site_zip,
        'scheduled_date', w.scheduled_date, 'start_date', w.start_date, 'end_date', w.end_date,
        'start_time', w.start_time, 'end_time', w.end_time, 'time_zone', w.time_zone,
        'poc_name', w.poc_name, 'poc_phone', w.poc_phone, 'poc_email', w.poc_email,
        'access_instructions', w.access_instructions, 'parking_instructions', w.parking_instructions,
        'special_instructions', w.special_instructions, 'deliverables', w.deliverables,
        'deliverable_instructions', w.deliverable_instructions,
        'tools_required', w.tools_required, 'required_skills', w.required_skills,
        'wo_tasks', COALESCE(w.wo_tasks, '[]'::jsonb),
        'custom_qa', COALESCE(w.custom_qa, '[]'::jsonb),
        'photo_required', COALESCE(w.photo_required, false),
        'signature_required', COALESCE(w.signature_required, false),
        'techs', CASE WHEN COALESCE(array_length(w.contractor_names, 1), 0) > 0 THEN to_jsonb(w.contractor_names)
                      WHEN COALESCE(w.contractor_name, '') <> '' THEN jsonb_build_array(w.contractor_name)
                      ELSE '[]'::jsonb END,
        'my_response', w.assignment_responses -> v_name ->> 'status',
        'my_time_request', w.time_requests -> v_name,
        'closeout', w.closeout,
        'checked_in_at', COALESCE(ctl.checked_in_at, w.checked_in_at),
        'checked_out_at', COALESCE(ctl.checked_out_at, w.checked_out_at),
        'closeout_notes', w.closeout_notes,
        'updated_at', w.updated_at
      ) AS j,
      COALESCE(w.scheduled_date, w.start_date, w.created_at::date) AS sort_date,
      w.wo_number
      FROM work_orders w
      LEFT JOIN contractor_time_logs ctl ON ctl.wo_id = w.id AND ctl.contractor_name = v_name
      WHERE w.user_id = v_owner
        AND w.archived_at IS NULL
        AND COALESCE(w.wo_status, 'Open') <> 'Cancelled'
        AND (w.contractor_name = v_name
             OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
             OR w.lead_contractor_name = v_name)
        AND (COALESCE(w.wo_status, 'Open') NOT IN ('Work Done', 'Approved', 'Paid')
             OR w.updated_at > now() - interval '45 days')
    ) sub
  ), '[]'::jsonb);
END;
$$;

-- One closeout change on the tech's own live job.
--   tick          { item, done }                 item: a deliverable label
--   add_delay     { id, reason, start, end }     start/end: timestamps
--   remove_delay  { id }
--   sign          { name }                       signed at the tap time (p_at)
--   clear_sign    {}
CREATE OR REPLACE FUNCTION public.wf_tech_closeout(p_wo_number text, p_op text, p_args jsonb, p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx    jsonb := tech_ctx();
  v_name   text;
  v_wo     work_orders%ROWTYPE;
  v_c      jsonb;
  v_done   jsonb;
  v_delays jsonb;
  v_item   text;
  v_id     text;
  v_start  timestamptz;
  v_end    timestamptz;
  v_signer text;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  v_name := v_ctx ->> 'contractor_name';
  SELECT * INTO v_wo FROM work_orders w
   WHERE w.wo_number = p_wo_number AND w.user_id = (v_ctx ->> 'owner_id')::uuid AND w.archived_at IS NULL
     AND COALESCE(w.wo_status, 'Open') NOT IN ('Approved', 'Paid', 'Cancelled')
     AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name)
   LIMIT 1
   FOR UPDATE;
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;

  v_c := CASE WHEN jsonb_typeof(v_wo.closeout) = 'object' THEN v_wo.closeout ELSE '{}'::jsonb END;
  v_done := CASE WHEN jsonb_typeof(v_c -> 'done') = 'array' THEN v_c -> 'done' ELSE '[]'::jsonb END;
  v_delays := CASE WHEN jsonb_typeof(v_c -> 'delays') = 'array' THEN v_c -> 'delays' ELSE '[]'::jsonb END;
  p_args := COALESCE(p_args, '{}'::jsonb);

  IF p_op = 'tick' THEN
    v_item := left(btrim(COALESCE(p_args ->> 'item', '')), 200);
    IF v_item = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout'); END IF;
    -- Drop it, then add it back when ticked: repeating a tap changes nothing.
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_done
      FROM jsonb_array_elements(v_done) e WHERE e #>> '{}' <> v_item;
    IF COALESCE((p_args ->> 'done')::boolean, false) AND jsonb_array_length(v_done) < 60 THEN
      v_done := v_done || to_jsonb(v_item);
    END IF;
    v_c := v_c || jsonb_build_object('done', v_done);

  ELSIF p_op = 'add_delay' THEN
    v_id := left(COALESCE(p_args ->> 'id', ''), 60);
    BEGIN
      v_start := (p_args ->> 'start')::timestamptz;
      v_end   := (p_args ->> 'end')::timestamptz;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout');
    END;
    IF v_id = '' OR v_start IS NULL OR v_end IS NULL OR v_end < v_start OR v_end - v_start > interval '24 hours' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout');
    END IF;
    -- The same delay sent twice (a retry) is kept once.
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_delays) e WHERE e ->> 'id' = v_id)
       AND jsonb_array_length(v_delays) < 50 THEN
      v_delays := v_delays || jsonb_build_object(
        'id', v_id,
        'reason', NULLIF(left(btrim(COALESCE(p_args ->> 'reason', '')), 300), ''),
        'start', v_start, 'end', v_end, 'by', v_name);
    END IF;
    v_c := v_c || jsonb_build_object('delays', v_delays);

  ELSIF p_op = 'remove_delay' THEN
    v_id := COALESCE(p_args ->> 'id', '');
    SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb) INTO v_delays
      FROM jsonb_array_elements(v_delays) WITH ORDINALITY AS t(e, ord) WHERE e ->> 'id' <> v_id;
    v_c := v_c || jsonb_build_object('delays', v_delays);

  ELSIF p_op = 'sign' THEN
    v_signer := left(btrim(COALESCE(p_args ->> 'name', '')), 120);
    IF v_signer = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout'); END IF;
    v_c := v_c || jsonb_build_object('signoff', jsonb_build_object(
      'name', v_signer, 'signed_at', wf_trusted_time(p_at), 'by', v_name));

  ELSIF p_op = 'clear_sign' THEN
    v_c := v_c || jsonb_build_object('signoff', NULL);

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout');
  END IF;

  UPDATE work_orders SET closeout = v_c, updated_at = now() WHERE id = v_wo.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.wf_tech_closeout(text, text, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_closeout(text, text, jsonb, timestamptz) TO authenticated;

-- A tech offered a job asks for another date and time (or, with no date, takes
-- the ask back). Only before the work starts, and only on their own offer.
CREATE OR REPLACE FUNCTION public.wf_tech_request_time(p_wo_number text, p_date date, p_time text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx  jsonb := tech_ctx();
  v_name text;
  v_wo   work_orders%ROWTYPE;
  v_reqs jsonb;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  v_name := v_ctx ->> 'contractor_name';
  SELECT * INTO v_wo FROM work_orders w
   WHERE w.wo_number = p_wo_number AND w.user_id = (v_ctx ->> 'owner_id')::uuid AND w.archived_at IS NULL
     AND COALESCE(w.wo_status, 'Open') IN ('Open', 'Assigned')
     AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name)
   LIMIT 1
   FOR UPDATE;
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;

  v_reqs := CASE WHEN jsonb_typeof(v_wo.time_requests) = 'object' THEN v_wo.time_requests ELSE '{}'::jsonb END;
  IF p_date IS NULL THEN
    v_reqs := v_reqs - v_name;
  ELSE
    IF p_date < current_date - 1 OR p_date > current_date + 366 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_date');
    END IF;
    v_reqs := v_reqs || jsonb_build_object(v_name, jsonb_build_object(
      'date', p_date,
      'time', NULLIF(left(btrim(COALESCE(p_time, '')), 20), ''),
      'note', NULLIF(left(btrim(COALESCE(p_note, '')), 500), ''),
      'at', now(),
      'state', 'waiting'));
  END IF;

  UPDATE work_orders
     SET time_requests = CASE WHEN v_reqs = '{}'::jsonb THEN NULL ELSE v_reqs END, updated_at = now()
   WHERE id = v_wo.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.wf_tech_request_time(text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_request_time(text, date, text, text) TO authenticated;
