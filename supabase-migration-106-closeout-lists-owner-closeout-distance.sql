-- Migration 106: Primio layout follow-ups
--
-- Fred, 2026-10-04: "i want it identical to primio with a few changes" —
-- "show full address and distance", "build it as mentioned, but in admin so i
-- can make changes also still have the same log in".
--
--   closeout_lists           The deliverable checklists by job type, editable
--                            in admin (Settings). A job gets the first list
--                            whose keyword is in its title or description, or
--                            the list with no keywords. Seeded with Primio's
--                            three (kiosk, site survey, standard).
--   wf_tech_closeout_lists() A tech reads their office's lists (no money).
--   wf_tech_closeout(...)    The owner can now fill in a closeout too (Fred
--                            works jobs himself), the same one change at a
--                            time as a tech.
--   wf_tech_jobs()           Also returns the site's map position, so the
--                            Available list can say how far away a job is.

CREATE TABLE IF NOT EXISTS public.closeout_lists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  keywords   text[] NOT NULL DEFAULT '{}',
  items      text[] NOT NULL DEFAULT '{}',
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS closeout_lists_user_idx ON public.closeout_lists (user_id, sort);

ALTER TABLE public.closeout_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own closeout lists" ON public.closeout_lists;
CREATE POLICY "Users manage own closeout lists" ON public.closeout_lists
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Primio's lists, for each business that has work orders and no lists yet.
INSERT INTO public.closeout_lists (user_id, name, keywords, items, sort)
SELECT o.user_id, l.name, l.keywords, l.items, l.sort
FROM (SELECT DISTINCT user_id FROM public.work_orders WHERE user_id IS NOT NULL) o
CROSS JOIN (VALUES
  ('Kiosk install', ARRAY['kiosk'], ARRAY[
    'Boxes and equipment as delivered', 'Cable tester showing "Pass"', 'Bridge PC installed',
    'Ceiling pole and trim close-up', 'Ceiling pole attachment point', 'Tidy cable management',
    'Kiosk foot bolted down', 'Pin pad side view', 'Completed kiosk',
    'Kiosk in room: logo screen, pink LED, pin pad on', 'Gift card and credit card test receipts'], 1),
  ('Site survey', ARRAY['survey'], ARRAY[
    'Completed site survey form', 'Floorplan with drop locations noted', 'Hours needed per technician',
    'Materials list', 'Photo: building exterior and entrance', 'Photo: ISP demarc', 'Photo: MDF / IDF rooms',
    'Photo: existing racks and patch panels', 'Photo: ceiling and cable pathways',
    'Photo: each proposed drop location', 'Photo: power and grounding', 'Video walkthrough of the site',
    'Photos clear, well lit and labeled'], 2),
  ('Standard job', ARRAY[]::text[], ARRAY[
    'Before photos of the work area', 'Cable test results', 'Cables and patch panel labeled',
    'After photos of the finished work', 'Work area cleaned up'], 99)
) AS l(name, keywords, items, sort)
WHERE NOT EXISTS (SELECT 1 FROM public.closeout_lists c WHERE c.user_id = o.user_id);

CREATE OR REPLACE FUNCTION public.wf_tech_closeout_lists()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'keywords', to_jsonb(c.keywords),
                                        'items', to_jsonb(c.items), 'sort', c.sort) ORDER BY c.sort, c.name)
    FROM closeout_lists c WHERE c.user_id = (v_ctx ->> 'owner_id')::uuid
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_closeout_lists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_closeout_lists() TO authenticated;

-- Closeout changes from a tech on their own job, or from the owner on any of
-- their live jobs (the same rule as wf_set_task).
CREATE OR REPLACE FUNCTION public.wf_tech_closeout(p_wo_number text, p_op text, p_args jsonb, p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx    jsonb := tech_ctx();
  v_name   text;
  v_id     uuid;
  v_wo     work_orders%ROWTYPE;
  v_c      jsonb;
  v_done   jsonb;
  v_delays jsonb;
  v_item   text;
  v_did    text;
  v_start  timestamptz;
  v_end    timestamptz;
  v_signer text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in'); END IF;

  IF v_ctx IS NOT NULL AND (v_ctx ->> 'owner_id')::uuid <> auth.uid() THEN
    v_name := v_ctx ->> 'contractor_name';
    SELECT w.id INTO v_id FROM work_orders w
     WHERE w.wo_number = p_wo_number AND w.user_id = (v_ctx ->> 'owner_id')::uuid AND w.archived_at IS NULL
       AND COALESCE(w.wo_status, 'Open') NOT IN ('Approved', 'Paid', 'Cancelled')
       AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
            OR w.lead_contractor_name = v_name)
     LIMIT 1;
  ELSIF is_business_owner(auth.uid()) THEN
    v_name := 'Office';
    SELECT w.id INTO v_id FROM work_orders w
     WHERE w.wo_number = p_wo_number AND w.user_id = auth.uid() AND w.archived_at IS NULL
     LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;

  SELECT * INTO v_wo FROM work_orders WHERE id = v_id FOR UPDATE;

  v_c := CASE WHEN jsonb_typeof(v_wo.closeout) = 'object' THEN v_wo.closeout ELSE '{}'::jsonb END;
  v_done := CASE WHEN jsonb_typeof(v_c -> 'done') = 'array' THEN v_c -> 'done' ELSE '[]'::jsonb END;
  v_delays := CASE WHEN jsonb_typeof(v_c -> 'delays') = 'array' THEN v_c -> 'delays' ELSE '[]'::jsonb END;
  p_args := COALESCE(p_args, '{}'::jsonb);

  IF p_op = 'tick' THEN
    v_item := left(btrim(COALESCE(p_args ->> 'item', '')), 200);
    IF v_item = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout'); END IF;
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_done
      FROM jsonb_array_elements(v_done) e WHERE e #>> '{}' <> v_item;
    IF COALESCE((p_args ->> 'done')::boolean, false) AND jsonb_array_length(v_done) < 60 THEN
      v_done := v_done || to_jsonb(v_item);
    END IF;
    v_c := v_c || jsonb_build_object('done', v_done);

  ELSIF p_op = 'add_delay' THEN
    v_did := left(COALESCE(p_args ->> 'id', ''), 60);
    BEGIN
      v_start := (p_args ->> 'start')::timestamptz;
      v_end   := (p_args ->> 'end')::timestamptz;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout');
    END;
    IF v_did = '' OR v_start IS NULL OR v_end IS NULL OR v_end < v_start OR v_end - v_start > interval '24 hours' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_delays) e WHERE e ->> 'id' = v_did)
       AND jsonb_array_length(v_delays) < 50 THEN
      v_delays := v_delays || jsonb_build_object(
        'id', v_did,
        'reason', NULLIF(left(btrim(COALESCE(p_args ->> 'reason', '')), 300), ''),
        'start', v_start, 'end', v_end, 'by', v_name);
    END IF;
    v_c := v_c || jsonb_build_object('delays', v_delays);

  ELSIF p_op = 'remove_delay' THEN
    v_did := COALESCE(p_args ->> 'id', '');
    SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb) INTO v_delays
      FROM jsonb_array_elements(v_delays) WITH ORDINALITY AS t(e, ord) WHERE e ->> 'id' <> v_did;
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

  UPDATE work_orders SET closeout = v_c, updated_at = now() WHERE id = v_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_closeout(text, text, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_closeout(text, text, jsonb, timestamptz) TO authenticated;

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
        'site_lat', w.site_lat, 'site_lng', w.site_lng,
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
