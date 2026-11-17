-- Individual office/technician threads. Availability is an enquiry, never an assignment.
BEGIN;

CREATE OR REPLACE FUNCTION public.staff_role_allowed(p_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT p_role IN ('assistant', 'accountant', 'project_manager'); $$;

CREATE OR REPLACE FUNCTION public.asst_ctx()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$ DECLARE v jsonb := staff_ctx(); BEGIN
  IF v IS NULL OR v->>'role' NOT IN ('assistant', 'project_manager') THEN RETURN NULL; END IF;
  RETURN v;
END; $$;

CREATE TABLE public.team_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  office_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id),
  sender_name text NOT NULL,
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  job_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  job_number text,
  job_title text,
  job_place text,
  proposed_date date,
  availability text CHECK (availability IN ('pending', 'available', 'unavailable')),
  response_note text CHECK (length(response_note) <= 1000),
  responded_at timestamptz,
  CHECK (availability IS NULL OR proposed_date IS NOT NULL)
);
CREATE INDEX team_messages_thread_idx ON public.team_messages(owner_id, office_id, contractor_id, created_at);
ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;
-- No direct grants or permissive policies: all access is through checked RPCs.
REVOKE ALL ON public.team_messages FROM anon, authenticated;

CREATE FUNCTION public.messaging_ctx()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$ DECLARE v jsonb; BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF is_business_owner(auth.uid()) THEN
    RETURN jsonb_build_object('owner_id', auth.uid(), 'name', 'Administrator', 'role', 'admin');
  END IF;
  v := asst_ctx();
  IF v IS NOT NULL THEN RETURN v; END IF;
  v := tech_ctx();
  IF v IS NOT NULL THEN RETURN v || jsonb_build_object('role', 'technician', 'name', v->>'contractor_name'); END IF;
  RETURN NULL;
END; $$;

CREATE FUNCTION public.messaging_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$ DECLARE v jsonb := messaging_ctx(); o uuid; contacts jsonb; jobs jsonb; msgs jsonb; BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'Messaging access denied' USING ERRCODE = '42501'; END IF;
  o := (v->>'owner_id')::uuid;
  IF v->>'role' = 'technician' THEN
    SELECT jsonb_agg(x) INTO contacts FROM (
      SELECT o AS id, 'Administrator'::text AS name, 'admin'::text AS role, true AS connected
      UNION ALL
      SELECT s.auth_user_id, s.name, s.role, true FROM staff_members s
      WHERE s.owner_id = o AND s.enabled AND s.auth_user_id IS NOT NULL
        AND s.role IN ('assistant', 'project_manager')
    ) x;
    jobs := '[]'::jsonb;
  ELSE
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'role', 'technician',
      'connected', c.auth_user_id IS NOT NULL AND c.portal_enabled) ORDER BY c.name)
      INTO contacts FROM contractors c WHERE c.user_id = o AND c.portal_enabled;
    SELECT jsonb_agg(jsonb_build_object('id', w.id, 'number', w.wo_number, 'title', w.title,
      'place', concat_ws(', ', w.site_city, w.site_state), 'date', w.scheduled_date) ORDER BY w.wo_number DESC)
      INTO jobs FROM work_orders w WHERE w.user_id = o AND w.archived_at IS NULL;
  END IF;
  SELECT jsonb_agg(x ORDER BY x.created_at) INTO msgs FROM (
    SELECT m.*, CASE WHEN v->>'role' = 'technician' THEN m.office_id ELSE m.contractor_id END AS peer_id,
      m.sender_id = auth.uid() AS mine
    FROM team_messages m WHERE m.owner_id = o AND (
      (v->>'role' = 'technician' AND m.contractor_id = (v->>'contractor_id')::uuid)
      OR (v->>'role' <> 'technician' AND m.office_id = auth.uid()))
  ) x;
  RETURN jsonb_build_object('me', jsonb_build_object('id', auth.uid(), 'name', v->>'name', 'role', v->>'role'),
    'contacts', coalesce(contacts, '[]'::jsonb), 'jobs', coalesce(jobs, '[]'::jsonb), 'messages', coalesce(msgs, '[]'::jsonb));
END; $$;

CREATE FUNCTION public.messaging_unread()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$ DECLARE v jsonb := messaging_ctx(); n integer; BEGIN
  IF v IS NULL THEN RETURN 0; END IF;
  SELECT count(*) INTO n FROM team_messages m WHERE m.owner_id = (v->>'owner_id')::uuid
    AND m.sender_id <> auth.uid() AND m.read_at IS NULL AND (
      (v->>'role' = 'technician' AND m.contractor_id = (v->>'contractor_id')::uuid)
      OR (v->>'role' <> 'technician' AND m.office_id = auth.uid()));
  RETURN n;
END; $$;

CREATE FUNCTION public.messaging_send(p_peer uuid, p_content text, p_job uuid DEFAULT NULL, p_date date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ DECLARE v jsonb := messaging_ctx(); o uuid; office uuid; tech uuid; w work_orders%ROWTYPE; BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'Messaging access denied' USING ERRCODE = '42501'; END IF;
  o := (v->>'owner_id')::uuid;
  IF nullif(btrim(p_content), '') IS NULL OR length(p_content) > 4000 THEN RAISE EXCEPTION 'Enter a message of up to 4000 characters'; END IF;
  IF v->>'role' = 'technician' THEN
    tech := (v->>'contractor_id')::uuid; office := p_peer;
    IF p_peer <> o AND NOT EXISTS (SELECT 1 FROM staff_members s WHERE s.owner_id = o
      AND s.auth_user_id = p_peer AND s.enabled AND s.role IN ('assistant', 'project_manager')) THEN
      RAISE EXCEPTION 'Contact not available' USING ERRCODE = '42501';
    END IF;
    IF p_job IS NOT NULL OR p_date IS NOT NULL THEN RAISE EXCEPTION 'Only office staff can request availability'; END IF;
  ELSE
    office := auth.uid(); tech := p_peer;
    IF NOT EXISTS (SELECT 1 FROM contractors c WHERE c.id = tech AND c.user_id = o
      AND c.portal_enabled AND c.auth_user_id IS NOT NULL) THEN RAISE EXCEPTION 'Technician needs an active portal login'; END IF;
  END IF;
  IF p_job IS NOT NULL THEN
    SELECT * INTO w FROM work_orders WHERE id = p_job AND user_id = o AND archived_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work order not available'; END IF;
    IF p_date IS NULL OR p_date < (now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'Choose today or a future date'; END IF;
  ELSIF p_date IS NOT NULL THEN RAISE EXCEPTION 'Choose a work order'; END IF;
  INSERT INTO team_messages(owner_id, office_id, contractor_id, sender_id, sender_name, content,
    job_id, job_number, job_title, job_place, proposed_date, availability)
  VALUES (o, office, tech, auth.uid(), v->>'name', btrim(p_content), p_job, w.wo_number, w.title,
    CASE WHEN p_job IS NOT NULL THEN concat_ws(', ', w.site_city, w.site_state) END,
    p_date, CASE WHEN p_job IS NOT NULL THEN 'pending' END);
END; $$;

CREATE FUNCTION public.messaging_read(p_peer uuid, p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ DECLARE v jsonb := messaging_ctx(); BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'Messaging access denied' USING ERRCODE = '42501'; END IF;
  UPDATE team_messages m SET read_at = now() WHERE m.owner_id = (v->>'owner_id')::uuid
    AND m.id = ANY(p_ids) AND m.sender_id <> auth.uid() AND m.read_at IS NULL AND (
      (v->>'role' = 'technician' AND m.contractor_id = (v->>'contractor_id')::uuid AND m.office_id = p_peer)
      OR (v->>'role' <> 'technician' AND m.office_id = auth.uid() AND m.contractor_id = p_peer));
END; $$;

CREATE FUNCTION public.messaging_respond(p_id uuid, p_status text, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ DECLARE v jsonb := tech_ctx(); r team_messages%ROWTYPE; BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'Technician access required' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('available', 'unavailable') OR p_status IS NULL OR length(coalesce(p_note, '')) > 1000 THEN RAISE EXCEPTION 'Invalid availability reply'; END IF;
  UPDATE team_messages m SET availability = p_status, response_note = nullif(btrim(p_note), ''), responded_at = now()
    WHERE m.id = p_id AND m.owner_id = (v->>'owner_id')::uuid
      AND m.contractor_id = (v->>'contractor_id')::uuid AND m.availability = 'pending'
    RETURNING m.* INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request already answered or not available'; END IF;
  -- A reply is incoming activity for the office, not merely an edit to its
  -- outgoing request: it needs its own unread state and activity timestamp.
  INSERT INTO team_messages(owner_id, office_id, contractor_id, sender_id, sender_name, content)
  VALUES (r.owner_id, r.office_id, r.contractor_id, auth.uid(), v->>'contractor_name',
    CASE p_status WHEN 'available' THEN 'Available' ELSE 'Unavailable' END
      || ' for WO ' || coalesce(r.job_number, '') || ' on ' || r.proposed_date::text
      || CASE WHEN nullif(btrim(p_note), '') IS NOT NULL THEN E'\n' || btrim(p_note) ELSE '' END);
END; $$;

REVOKE ALL ON FUNCTION public.messaging_ctx() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messaging_snapshot(), public.messaging_unread(), public.messaging_send(uuid,text,uuid,date),
  public.messaging_read(uuid,uuid[]), public.messaging_respond(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_snapshot(), public.messaging_unread(), public.messaging_send(uuid,text,uuid,date),
  public.messaging_read(uuid,uuid[]), public.messaging_respond(uuid,text,text) TO authenticated;
COMMIT;
