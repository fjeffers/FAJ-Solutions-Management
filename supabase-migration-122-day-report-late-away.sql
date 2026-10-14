-- Migration 122: end-of-day report, "stepped off site", and running late.
--
-- Fred, 2026-10-14:
--   "on day one is completed: what was done, what's remaining, and then it
--    asks traveling to home or hotel"            → message kind 'report'
--   "he leaves the site, the GPS should show him off site and ask a reason:
--    break, lunch, leaving for the day or other, he explains; the PM gets
--    that notification"                          → message kind 'away'
--   "even if the schedule time and the tech is not there, mark late after
--    30 min, with a reason ... especially if there are multiple days"
--                                                → project_late, checked every 5 minutes
-- All three show on the live sheet and alert the project's list.

ALTER TABLE public.work_order_messages DROP CONSTRAINT IF EXISTS work_order_messages_kind_check;
ALTER TABLE public.work_order_messages ADD CONSTRAINT work_order_messages_kind_check
  CHECK (kind IN ('message', 'question', 'answer', 'note', 'issue', 'resolved', 'report', 'away', 'late'));

ALTER TABLE public.project_alerts DROP CONSTRAINT IF EXISTS project_alerts_kind_check;
ALTER TABLE public.project_alerts ADD CONSTRAINT project_alerts_kind_check CHECK (kind = ANY (ARRAY[
  'day_start', 'travel_start', 'travel_end', 'sign_out', 'start_job', 'off_site', 'site_finished',
  'photos', 'receipt', 'notes', 'answers', 'test',
  'message', 'issue', 'resolved', 'answer', 'client_message',
  'report', 'away', 'late']));

-- wf_tech_site_send takes the end-of-day report and "stepped off site" too.
CREATE OR REPLACE FUNCTION public.wf_tech_site_send(p_wo_number text, p_body text, p_to text DEFAULT NULL,
  p_kind text DEFAULT 'message', p_reason text DEFAULT NULL, p_parent uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text := tech_ctx()->>'contractor_name';
  v_wo work_orders%ROWTYPE;
  v_parent work_order_messages%ROWTYPE;
  v_body text := left(btrim(COALESCE(p_body, '')), 2000);
  v_to text := NULLIF(left(btrim(COALESCE(p_to, '')), 80), '');
  v_reason text := NULLIF(left(btrim(COALESCE(p_reason, '')), 200), '');
  v_sheet boolean;
  v_id uuid;
  v_c jsonb;
  v_iso text := 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
BEGIN
  v_wo := wf_tech_own_job(p_wo_number);
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_your_job'); END IF;
  IF p_kind NOT IN ('message', 'answer', 'issue', 'resolved', 'report', 'away') THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_kind'); END IF;

  IF p_parent IS NOT NULL THEN
    SELECT * INTO v_parent FROM work_order_messages
     WHERE id = p_parent AND user_id = v_wo.user_id AND work_order_id = v_wo.wo_number;
    IF v_parent.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_parent'); END IF;
  END IF;

  IF v_to = 'FAJ' THEN v_to := NULL; v_sheet := false;
  ELSE v_sheet := COALESCE(v_wo.is_project, false)
    AND (v_to IS NOT NULL OR COALESCE(v_parent.on_sheet, false) OR p_kind IN ('issue', 'resolved', 'report', 'away'));
  END IF;
  IF v_to = 'Everyone' THEN v_to := NULL; END IF;
  IF p_kind = 'answer' AND v_parent.id IS NOT NULL THEN v_to := COALESCE(v_to, v_parent.sender_name); v_sheet := v_sheet OR v_parent.on_sheet; END IF;

  IF p_kind = 'issue' THEN
    IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'reason_needed'); END IF;
    IF v_body = '' THEN v_body := 'No access to the building'; END IF;
  ELSIF p_kind = 'away' THEN
    IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'reason_needed'); END IF;
    IF v_body = '' THEN v_body := 'Stepped off site'; END IF;
  ELSIF p_kind = 'resolved' THEN
    IF v_parent.id IS NULL OR v_parent.kind <> 'issue' OR v_parent.sender_name <> v_name THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_parent');
    END IF;
    IF v_parent.resolved_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
    IF v_body = '' THEN v_body := 'Got access'; END IF;
    v_to := COALESCE(v_to, v_parent.to_name);
    v_sheet := v_parent.on_sheet;
  ELSIF v_body = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty');
  END IF;

  INSERT INTO work_order_messages (user_id, work_order_id, sender_name, sender_role, content, kind, to_name, on_sheet, reason, parent_id)
  VALUES (v_wo.user_id, v_wo.wo_number, v_name, 'contractor', v_body, p_kind, v_to, v_sheet, v_reason, p_parent)
  RETURNING id INTO v_id;

  IF p_kind IN ('answer', 'resolved') THEN
    UPDATE work_order_messages SET resolved_at = now() WHERE id = p_parent AND resolved_at IS NULL;
  END IF;

  IF p_kind = 'resolved' THEN
    v_c := CASE WHEN jsonb_typeof(v_wo.closeout) = 'object' THEN v_wo.closeout ELSE '{}'::jsonb END;
    v_c := jsonb_set(v_c, '{delays}', COALESCE(v_c->'delays', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id', v_parent.id::text,
      'reason', v_parent.content || COALESCE(': ' || v_parent.reason, ''),
      'start', to_char(v_parent.created_at AT TIME ZONE 'UTC', v_iso),
      'end', to_char(now() AT TIME ZONE 'UTC', v_iso))));
    UPDATE work_orders SET closeout = v_c, updated_at = now() WHERE id = v_wo.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- The alert trigger knows the new kinds.
CREATE OR REPLACE FUNCTION public.project_alert_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo uuid; v_waited numeric;
BEGIN
  BEGIN
    IF NEW.on_sheet THEN
      SELECT id INTO v_wo FROM work_orders
       WHERE user_id = NEW.user_id AND wo_number = NEW.work_order_id AND COALESCE(is_project, false) LIMIT 1;
      IF v_wo IS NOT NULL THEN
        IF NEW.kind = 'resolved' THEN
          SELECT round(extract(epoch FROM NEW.created_at - p.created_at) / 60) INTO v_waited FROM work_order_messages p WHERE p.id = NEW.parent_id;
        END IF;
        PERFORM project_alert_add(v_wo,
          CASE WHEN NEW.sender_role <> 'contractor' THEN 'client_message'
               WHEN NEW.kind IN ('issue', 'resolved', 'answer', 'report', 'away', 'late') THEN NEW.kind ELSE 'message' END,
          NEW.sender_name, NEW.created_at,
          jsonb_build_object('body', left(NEW.content, 1200), 'to', NEW.to_name, 'reason', NEW.reason,
                             'kind', NEW.kind, 'waited_min', v_waited, 'message_id', NEW.id));
      END IF;
    END IF;
  EXCEPTION WHEN others THEN RAISE WARNING 'project alert skipped: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

-- ── Running late ────────────────────────────────────────────────────────────
-- One row per tech, site and day they weren't on site 30 minutes after the
-- start time. Checked every 5 minutes on every scheduled day of the job
-- (start_date through end_date), Monday to Friday, until the site is closed.

CREATE TABLE IF NOT EXISTS public.project_late (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  wo_number text NOT NULL,
  tech text NOT NULL,
  day date NOT NULL,
  start_label text,
  due_at timestamptz NOT NULL,
  flagged_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  eta_min integer,
  note text,
  answered_at timestamptz,
  UNIQUE (wo_id, tech, day)
);
ALTER TABLE public.project_late ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_late_owner_read ON public.project_late;
CREATE POLICY project_late_owner_read ON public.project_late FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.project_late_check()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_n integer := 0; v_tz text; v_day date; v_start time; v_due timestamptz; v_id uuid;
BEGIN
  FOR r IN
    SELECT w.id, w.user_id, w.wo_number, w.project_name, w.start_time, w.time_zone,
           COALESCE(w.start_date, w.scheduled_date) AS first_day,
           COALESCE(w.end_date, w.start_date, w.scheduled_date) AS last_day, t.tech
      FROM work_orders w
      CROSS JOIN LATERAL (
        SELECT DISTINCT btrim(x) AS tech
          FROM unnest(ARRAY[w.lead_contractor_name, w.contractor_name] || COALESCE(w.contractor_names, ARRAY[]::text[])) x
         WHERE x IS NOT NULL AND btrim(x) <> '') t
     WHERE COALESCE(w.is_project, false) AND w.archived_at IS NULL
       AND COALESCE(w.wo_status, 'Open') NOT IN ('Work Done', 'Approved', 'Paid', 'Cancelled', 'Closed', 'Completed')
       AND NULLIF(btrim(w.start_time), '') IS NOT NULL
       AND COALESCE(w.start_date, w.scheduled_date) IS NOT NULL
  LOOP
    BEGIN
      v_tz := COALESCE(NULLIF(btrim(r.time_zone), ''), 'America/New_York');
      PERFORM now() AT TIME ZONE v_tz;
    EXCEPTION WHEN others THEN v_tz := 'America/New_York';
    END;
    v_day := (now() AT TIME ZONE v_tz)::date;
    CONTINUE WHEN v_day < r.first_day OR v_day > r.last_day OR extract(isodow FROM v_day) > 5;
    BEGIN v_start := btrim(r.start_time)::time;
    EXCEPTION WHEN others THEN CONTINUE;
    END;
    v_due := ((v_day + v_start) AT TIME ZONE v_tz) + interval '30 minutes';
    -- Only in the hours after the start (never flag in the evening).
    CONTINUE WHEN now() < v_due OR now() > v_due + interval '6 hours';
    -- On site here, or anywhere on the same project, today.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM job_punches p JOIN work_orders w2 ON w2.id = p.wo_id
       WHERE p.contractor_name = r.tech AND p.kind = 'in' AND w2.user_id = r.user_id
         AND (w2.id = r.id OR w2.project_name = r.project_name)
         AND (p.at AT TIME ZONE v_tz)::date = v_day);
    v_id := NULL;
    INSERT INTO project_late (user_id, wo_id, wo_number, tech, day, start_label, due_at)
    VALUES (r.user_id, r.id, r.wo_number, r.tech, v_day, btrim(r.start_time), v_due)
    ON CONFLICT (wo_id, tech, day) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      v_n := v_n + 1;
      PERFORM project_alert_add(r.id, 'late', r.tech, now(), jsonb_build_object('start', btrim(r.start_time), 'late_id', v_id));
    END IF;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.project_late_check() FROM PUBLIC, anon, authenticated;

-- The tech's own late marks for a job that still need a reason.
CREATE OR REPLACE FUNCTION public.wf_tech_late(p_wo_number text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo work_orders%ROWTYPE; v_name text := tech_ctx()->>'contractor_name';
BEGIN
  v_wo := wf_tech_own_job(p_wo_number);
  IF v_wo.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'day', l.day, 'start', l.start_label, 'due_at', l.due_at,
      'reason', l.reason, 'answered_at', l.answered_at) ORDER BY l.day DESC)
    FROM project_late l WHERE l.wo_id = v_wo.id AND l.tech = v_name AND l.day >= current_date - 1), '[]'::jsonb);
END $$;

-- Why they're late, and about how long until they're there. Goes on the sheet
-- and to the PM as a message.
CREATE OR REPLACE FUNCTION public.wf_tech_late_reason(p_id uuid, p_reason text, p_eta_min integer DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text := tech_ctx()->>'contractor_name';
  v_l project_late%ROWTYPE; v_wo work_orders%ROWTYPE;
  v_reason text := NULLIF(left(btrim(COALESCE(p_reason, '')), 200), '');
  v_note text := NULLIF(left(btrim(COALESCE(p_note, '')), 500), '');
  v_eta integer := CASE WHEN p_eta_min BETWEEN 1 AND 600 THEN p_eta_min END;
BEGIN
  SELECT * INTO v_l FROM project_late WHERE id = p_id;
  IF v_l.id IS NULL OR v_l.tech <> v_name THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_your_job'); END IF;
  v_wo := wf_tech_own_job(v_l.wo_number);
  IF v_wo.id IS NULL OR v_wo.id <> v_l.wo_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_your_job'); END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'reason_needed'); END IF;
  UPDATE project_late SET reason = v_reason, eta_min = v_eta, note = v_note, answered_at = now() WHERE id = v_l.id;
  INSERT INTO work_order_messages (user_id, work_order_id, sender_name, sender_role, content, kind, on_sheet, reason)
  VALUES (v_wo.user_id, v_wo.wo_number, v_name, 'contractor',
          'Running late' || CASE WHEN v_eta IS NOT NULL THEN ' · there in about ' || v_eta || ' min' ELSE '' END
            || COALESCE('. ' || v_note, ''),
          'late', COALESCE(v_wo.is_project, false), v_reason);
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.wf_tech_late(text), public.wf_tech_late_reason(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_late(text), public.wf_tech_late_reason(uuid, text, integer, text) TO authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'project-late-check';
SELECT cron.schedule('project-late-check', '*/5 * * * *', 'SELECT public.project_late_check()');
