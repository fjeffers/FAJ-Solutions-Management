-- Migration 121: messages on the live project sheet, and "No access".
--
-- Fred, 2026-10-14:
--   "the client can add notes under the pic and ask a question for the tech
--    to answer right away" ... "the app alerts him or whoever is on the work
--    order so they can see it and respond, and they also can ping someone or
--    send a message" ... "we don't have access to the building: I open the
--    app, open message, select the PM and say no access to the building. Then
--    it should ask reasons (box code is not working). The PM sees it and gets
--    the tech the info he needs" ... "until the PM gets back to him it shows
--    time spent without access; he gets the code, the app asks 'do you have
--    access?', he replies yes, the time on site carries on and the time
--    without access goes to the PM's sheet."
--
-- One thread per job, the one techs and the office already use
-- (work_order_messages). New here:
--   on_sheet  the message is on the live sheet (sent from it, or a tech sent
--             it to the PM / everyone). Tech <-> FAJ messages stay private.
--   kind      message | question | answer | note | issue | resolved
--   to_name   who it's for ("Dana", "Mike"); null = everyone on the site
--   row_ref   the sheet line it's under (a photo)
--   reason    an issue's reason ("Box code not working")
--   parent_id an answer's question / a resolved's issue
--   resolved_at  question answered / access granted
-- sender_role 'client' = someone on the sheet (the PM or the client).
-- When a tech says they have access, the wait goes on the job's closeout as
-- a delay, so it shows on the sheet, the reports and the job.

ALTER TABLE public.work_order_messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'message',
  ADD COLUMN IF NOT EXISTS to_name text,
  ADD COLUMN IF NOT EXISTS on_sheet boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS row_ref text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.work_order_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.work_order_messages ADD CONSTRAINT work_order_messages_kind_check
    CHECK (kind IN ('message', 'question', 'answer', 'note', 'issue', 'resolved'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS work_order_messages_sheet_idx
  ON public.work_order_messages (user_id, work_order_id, created_at) WHERE on_sheet;

ALTER TABLE public.project_alerts DROP CONSTRAINT IF EXISTS project_alerts_kind_check;
ALTER TABLE public.project_alerts ADD CONSTRAINT project_alerts_kind_check CHECK (kind = ANY (ARRAY[
  'day_start', 'travel_start', 'travel_end', 'sign_out', 'start_job', 'off_site', 'site_finished',
  'photos', 'receipt', 'notes', 'answers', 'test',
  'message', 'issue', 'resolved', 'answer', 'client_message']));

-- The tech's own job, by number (the same test as tech_messages).
CREATE OR REPLACE FUNCTION public.wf_tech_own_job(p_wo_number text)
RETURNS public.work_orders LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.* FROM work_orders w, LATERAL (SELECT tech_ctx() AS c) x
   WHERE x.c IS NOT NULL AND w.wo_number = p_wo_number AND w.user_id = (x.c->>'owner_id')::uuid
     AND (w.contractor_name = x.c->>'contractor_name'
          OR x.c->>'contractor_name' = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = x.c->>'contractor_name')
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_own_job(text) FROM PUBLIC, anon, authenticated;

-- Who a tech can message on a project: its PMs and the others on its list.
-- Never the office's own logins (the tech side doesn't talk about the office).
CREATE OR REPLACE FUNCTION public.wf_tech_site_contacts(p_wo_number text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo work_orders%ROWTYPE;
BEGIN
  v_wo := wf_tech_own_job(p_wo_number);
  IF v_wo.id IS NULL OR NOT COALESCE(v_wo.is_project, false) THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('name', p.name, 'role', p.role) ORDER BY p.created_at)
      FROM project_alert_people p
     WHERE p.user_id = v_wo.user_id AND p.project_name = v_wo.project_name AND p.role IN ('pm', 'other')
  ), '[]'::jsonb);
END $$;

-- A tech's message on the job. p_to: a name from wf_tech_site_contacts,
-- 'Everyone' (the whole sheet), or 'FAJ' / nothing (private, as before).
-- p_kind: message | answer (p_parent = the question) | issue (p_reason
-- required; starts the "without access" clock) | resolved (p_parent = the
-- issue; stops the clock and logs the wait as a closeout delay).
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
  IF p_kind NOT IN ('message', 'answer', 'issue', 'resolved') THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_kind'); END IF;

  IF p_parent IS NOT NULL THEN
    SELECT * INTO v_parent FROM work_order_messages
     WHERE id = p_parent AND user_id = v_wo.user_id AND work_order_id = v_wo.wo_number;
    IF v_parent.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_parent'); END IF;
  END IF;

  IF v_to = 'FAJ' THEN v_to := NULL; v_sheet := false;
  ELSE v_sheet := COALESCE(v_wo.is_project, false) AND (v_to IS NOT NULL OR COALESCE(v_parent.on_sheet, false) OR p_kind IN ('issue', 'resolved'));
  END IF;
  IF v_to = 'Everyone' THEN v_to := NULL; END IF;
  -- An answer goes back to whoever asked.
  IF p_kind = 'answer' AND v_parent.id IS NOT NULL THEN v_to := COALESCE(v_to, v_parent.sender_name); v_sheet := v_sheet OR v_parent.on_sheet; END IF;

  IF p_kind = 'issue' THEN
    IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'reason_needed'); END IF;
    IF v_body = '' THEN v_body := 'No access to the building'; END IF;
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

-- The tech's thread now carries who it's for, the kind and the rest.
CREATE OR REPLACE FUNCTION public.tech_messages(p_wo_number text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo work_orders%ROWTYPE; v_out jsonb;
BEGIN
  IF p_wo_number IS NULL THEN RETURN NULL; END IF;
  v_wo := wf_tech_own_job(p_wo_number);
  IF v_wo.id IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'sender_name', m.sender_name, 'sender_role', m.sender_role, 'content', m.content,
      'created_at', m.created_at, 'kind', m.kind, 'to_name', m.to_name, 'on_sheet', m.on_sheet,
      'reason', m.reason, 'parent_id', m.parent_id, 'resolved_at', m.resolved_at, 'row_ref', m.row_ref)
    ORDER BY m.created_at ASC) INTO v_out
  FROM work_order_messages m
  WHERE m.work_order_id = p_wo_number AND m.user_id = v_wo.user_id;
  RETURN COALESCE(v_out, '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.wf_tech_site_contacts(text), public.wf_tech_site_send(text, text, text, text, text, uuid), public.tech_messages(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_site_contacts(text), public.wf_tech_site_send(text, text, text, text, text, uuid), public.tech_messages(text) TO authenticated;

-- Sheet messages alert the project's list straight away (lib/project-alerts.ts
-- words them; a message from the sheet goes to the office logins only).
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
               WHEN NEW.kind IN ('issue', 'resolved', 'answer') THEN NEW.kind ELSE 'message' END,
          NEW.sender_name, NEW.created_at,
          jsonb_build_object('body', left(NEW.content, 600), 'to', NEW.to_name, 'reason', NEW.reason,
                             'kind', NEW.kind, 'waited_min', v_waited, 'message_id', NEW.id));
      END IF;
    END IF;
  EXCEPTION WHEN others THEN RAISE WARNING 'project alert skipped: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_alert_on_message ON public.work_order_messages;
CREATE TRIGGER project_alert_on_message AFTER INSERT ON public.work_order_messages
  FOR EACH ROW EXECUTE FUNCTION public.project_alert_on_message();

-- With two techs on a job the app can't tell "mine" from the sender role:
-- the thread says which messages are this tech's and which are meant for them.
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
      'for_me', m.to_name IS NULL OR m.to_name = v_name)
    ORDER BY m.created_at ASC) INTO v_out
  FROM work_order_messages m
  WHERE m.work_order_id = p_wo_number AND m.user_id = v_wo.user_id;
  RETURN COALESCE(v_out, '[]'::jsonb);
END $$;
