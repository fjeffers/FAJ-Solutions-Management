-- Migration 098: WorkFlow phase 2 — checklists, assigning techs, and taps made
-- with no signal.
--
-- Fred, 2026-10-02: "get this done" — techs ticking checklist items, Fred
-- assigning or changing techs from WorkFlow, Crew Projects inside WorkFlow,
-- and working without signal.
--
--   wf_set_task(wo, task, done)       tick a checklist item. A tech on their own
--                                     job, or the owner on any of theirs.
--   wf_set_techs(wo_id, techs)        the owner sets who is on a job. Money-safe:
--                                     a tech who has been PAID anything on the
--                                     job cannot be removed or swapped here (the
--                                     office app splits paid vs unpaid money,
--                                     lib/reassign.ts). An unpaid tech swapped
--                                     for one new tech hands over their pay
--                                     figure. Closed jobs cannot be changed.
--   wf_tech_clock_at(wo, action, at)  tech_clock, recording WHEN the tap happened.
--   wf_crew_punch_at(site, kind, lat, lng, at)
--                                     tech_crew_punch, the same way.
--
-- The *_at pair exists for no-signal mode: a tap made in a basement is queued
-- on the phone and sent when signal returns, and the hours must count from the
-- tap, not from the moment the phone reconnected. The time is only trusted
-- within the last 48 hours and not in the future; outside that, now() is used.

CREATE OR REPLACE FUNCTION public.wf_trusted_time(p_at timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT CASE WHEN p_at IS NULL OR p_at > now() + interval '5 minutes' OR p_at < now() - interval '48 hours'
              THEN now() ELSE p_at END;
$$;

-- ─── Checklist ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.wf_set_task(p_wo_number text, p_task_id text, p_done boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_owner uuid;
  v_name  text;
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in'); END IF;

  IF v_ctx IS NOT NULL AND (v_ctx ->> 'owner_id')::uuid <> auth.uid() THEN
    v_owner := (v_ctx ->> 'owner_id')::uuid;
    v_name  := v_ctx ->> 'contractor_name';
    SELECT w.id INTO v_id FROM work_orders w
     WHERE w.wo_number = p_wo_number AND w.user_id = v_owner AND w.archived_at IS NULL
       AND COALESCE(w.wo_status, 'Open') NOT IN ('Approved', 'Paid', 'Cancelled')
       AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
            OR w.lead_contractor_name = v_name);
  ELSIF is_business_owner(auth.uid()) THEN
    SELECT w.id INTO v_id FROM work_orders w
     WHERE w.wo_number = p_wo_number AND w.user_id = auth.uid() AND w.archived_at IS NULL;
  END IF;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;

  UPDATE work_orders w
     SET wo_tasks = (
           SELECT jsonb_agg(
                    CASE WHEN e.t ->> 'id' = p_task_id
                         THEN e.t || jsonb_build_object('completed', p_done,
                                                        'completed_at', CASE WHEN p_done THEN to_jsonb(now()) ELSE 'null'::jsonb END)
                         ELSE e.t END
                    ORDER BY e.ord)
           FROM jsonb_array_elements(w.wo_tasks) WITH ORDINALITY AS e(t, ord)),
         updated_at = now()
   WHERE w.id = v_id
     AND jsonb_typeof(w.wo_tasks) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.wo_tasks) t WHERE t ->> 'id' = p_task_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_such_task'); END IF;
  RETURN jsonb_build_object('ok', true, 'reason', CASE WHEN p_done THEN 'done' ELSE 'undone' END);
END;
$$;

-- ─── Who is on a job ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.wf_set_techs(p_wo_id uuid, p_techs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_owner   uuid := auth.uid();
  v_wo      work_orders%ROWTYPE;
  v_old     text[];
  v_new     text[] := ARRAY[]::text[];
  v_given   jsonb := '{}'::jsonb;   -- name -> pay typed in WorkFlow
  v_pay     jsonb;
  v_removed text[];
  v_added   text[];
  v_t       jsonb;
  v_name    text;
  v_paid    numeric;
  v_resp    jsonb;
BEGIN
  IF v_owner IS NULL OR NOT is_business_owner(v_owner) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;
  SELECT * INTO v_wo FROM work_orders WHERE id = p_wo_id AND user_id = v_owner;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_wo.archived_at IS NOT NULL OR COALESCE(v_wo.wo_status, 'Open') IN ('Approved', 'Paid', 'Cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed');
  END IF;

  FOR v_t IN SELECT * FROM jsonb_array_elements(COALESCE(p_techs, '[]'::jsonb)) LOOP
    v_name := trim(v_t ->> 'name');
    IF v_name = '' THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM contractors WHERE user_id = v_owner AND name = v_name) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'unknown_tech', 'name', v_name);
    END IF;
    IF NOT v_name = ANY(v_new) THEN v_new := v_new || v_name; END IF;
    IF NULLIF(v_t ->> 'pay', '') IS NOT NULL THEN
      v_given := v_given || jsonb_build_object(v_name, round((v_t ->> 'pay')::numeric, 2));
    END IF;
  END LOOP;

  v_old := CASE WHEN COALESCE(array_length(v_wo.contractor_names, 1), 0) > 0 THEN v_wo.contractor_names
                WHEN COALESCE(v_wo.contractor_name, '') <> '' THEN ARRAY[v_wo.contractor_name]
                ELSE ARRAY[]::text[] END;
  SELECT COALESCE(array_agg(n), ARRAY[]::text[]) INTO v_removed FROM unnest(v_old) n WHERE NOT n = ANY(v_new);
  SELECT COALESCE(array_agg(n), ARRAY[]::text[]) INTO v_added   FROM unnest(v_new) n WHERE NOT n = ANY(v_old);

  -- Money already paid to a tech on this job stays theirs; moving it is the office app's job.
  FOREACH v_name IN ARRAY v_removed LOOP
    SELECT COALESCE(sum(amount), 0) INTO v_paid FROM payments
     WHERE user_id = v_owner AND wo_number = v_wo.wo_number AND contractor_name = v_name;
    IF v_paid > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'paid_tech', 'name', v_name, 'paid', v_paid);
    END IF;
  END LOOP;

  -- Pay figures: keep the ones that stay, drop the ones that leave, carry an
  -- unpaid tech's figure to the one who replaces them (one out, one in, no new
  -- figure typed), then apply anything typed in WorkFlow.
  v_pay := COALESCE(v_wo.contractor_pay, '{}'::jsonb);
  IF array_length(v_removed, 1) = 1 AND array_length(v_added, 1) = 1
     AND v_pay ? v_removed[1] AND NOT v_given ? v_added[1] THEN
    v_pay := v_pay || jsonb_build_object(v_added[1], v_pay -> v_removed[1]);
  END IF;
  FOREACH v_name IN ARRAY v_removed LOOP v_pay := v_pay - v_name; END LOOP;
  v_pay := v_pay || v_given;

  -- A tech who leaves takes their yes or no with them; a new tech has not answered.
  v_resp := COALESCE(v_wo.assignment_responses, '{}'::jsonb);
  FOREACH v_name IN ARRAY v_removed LOOP v_resp := v_resp - v_name; END LOOP;

  UPDATE work_orders SET
    contractor_names = v_new,
    contractor_name = COALESCE(v_new[1], ''),
    lead_contractor_name = CASE WHEN lead_contractor_name = ANY(v_new) THEN lead_contractor_name ELSE v_new[1] END,
    contractor_pay = CASE WHEN v_pay = '{}'::jsonb THEN NULL ELSE v_pay END,  -- empty = "pay not set" (hasPaySplit)
    assignment_responses = v_resp,
    wo_status = CASE WHEN array_length(v_new, 1) IS NULL AND COALESCE(wo_status, 'Open') IN ('Open', 'Assigned') THEN 'Open'
                     WHEN array_length(v_new, 1) > 0 AND COALESCE(wo_status, 'Open') = 'Open' THEN 'Assigned'
                     ELSE wo_status END,
    updated_at = now()
  WHERE id = v_wo.id;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (v_owner, 'update', 'work_order', v_wo.id::text,
          jsonb_build_object('label', 'WO ' || v_wo.wo_number || ' techs changed in WorkFlow',
                             'from', to_jsonb(v_old), 'to', to_jsonb(v_new)));
  RETURN jsonb_build_object('ok', true, 'reason', 'saved', 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
END;
$$;

-- ─── Taps that happened while there was no signal ───────────────────────────

CREATE OR REPLACE FUNCTION public.wf_tech_clock_at(p_wo_number text, p_action text, p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_name text;
  v_owner uuid;
  v_wo work_orders%ROWTYPE;
  v_log_id uuid;
  v_at timestamptz := wf_trusted_time(p_at);
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
    UPDATE contractor_time_logs SET checked_in_at = v_at, checked_out_at = NULL, updated_at = now() WHERE id = v_log_id;
    UPDATE work_orders SET wo_status = 'In Progress', updated_at = now()
     WHERE id = v_wo.id AND wo_status IN ('Open', 'Assigned');
  ELSE
    UPDATE contractor_time_logs SET checked_out_at = GREATEST(v_at, COALESCE(checked_in_at, v_at)), updated_at = now()
     WHERE id = v_log_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'reason', p_action, 'at', v_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_crew_punch_at(p_site uuid, p_kind text, p_lat double precision, p_lng double precision, p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_team  uuid;
  v_at    timestamptz := wf_trusted_time(p_at);
  v_date  date := (wf_trusted_time(p_at) AT TIME ZONE 'America/New_York')::date;
  v_state text;
  v_ok    boolean;
  v_entry record;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  v_team := crew_tech_site_team(p_site);
  IF v_team IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_your_site'); END IF;

  SELECT status INTO v_entry FROM crew_time_entries WHERE site_id = p_site AND work_date = v_date;
  IF FOUND AND v_entry.status = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_approved');
  END IF;

  v_state := crew_day_state(p_site, v_date);
  v_ok := CASE p_kind
    WHEN 'in'          THEN v_state = 'off'
    WHEN 'out'         THEN v_state IN ('on','break','meal')
    WHEN 'break_start' THEN v_state = 'on'
    WHEN 'break_end'   THEN v_state = 'break'
    WHEN 'meal_start'  THEN v_state = 'on'
    WHEN 'meal_end'    THEN v_state = 'meal'
    ELSE false END;
  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_step', 'state', v_state);
  END IF;

  IF p_kind = 'out' AND v_state IN ('break','meal') THEN
    INSERT INTO crew_punches (user_id, site_id, team_id, work_date, kind, at, lat, lng, entered_by)
    VALUES ((v_ctx ->> 'owner_id')::uuid, p_site, v_team, v_date,
            CASE v_state WHEN 'break' THEN 'break_end' ELSE 'meal_end' END, v_at, p_lat, p_lng, v_ctx ->> 'contractor_name');
  END IF;

  INSERT INTO crew_punches (user_id, site_id, team_id, work_date, kind, at, lat, lng, entered_by)
  VALUES ((v_ctx ->> 'owner_id')::uuid, p_site, v_team, v_date, p_kind, v_at, p_lat, p_lng, v_ctx ->> 'contractor_name');

  PERFORM crew_rebuild_day(p_site, v_date);
  UPDATE crew_sites SET status = 'in_progress', updated_at = now()
   WHERE id = p_site AND status IN ('planned','scheduled');

  RETURN jsonb_build_object('ok', true, 'reason', 'saved', 'state', crew_day_state(p_site, v_date));
END;
$$;

REVOKE ALL ON FUNCTION public.wf_trusted_time(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wf_set_task(text, text, boolean), public.wf_set_techs(uuid, jsonb),
  public.wf_tech_clock_at(text, text, timestamptz),
  public.wf_crew_punch_at(uuid, text, double precision, double precision, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_set_task(text, text, boolean), public.wf_set_techs(uuid, jsonb),
  public.wf_tech_clock_at(text, text, timestamptz),
  public.wf_crew_punch_at(uuid, text, double precision, double precision, timestamptz) TO authenticated;
