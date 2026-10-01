-- Migration 088: crew leads schedule themselves, and the project has a channel.
--
-- Fred uploads the sites; leads pick their own weeks from the tech portal.
-- Rules the database enforces, so a phone cannot break them:
--   * a lead can only claim an UNASSIGNED site, in a project where they lead a team
--   * only into a real project week that is not a holiday week
--   * one site per team per week (each team does one meetinghouse a week)
--   * they can give a site back only while nothing has been logged against it
-- Fred can still move anything from the owner app; these rules bind leads only.
--
-- crew_messages is the project channel:
--   to_contractor_id NULL and to_office false  → everyone on the project
--   to_office true                              → private to Fred
--   to_contractor_id set                        → private to that lead
--   from_contractor_id NULL                     → sent by Fred from the office
-- Fred sees every message (owner RLS). A lead sees everyone-messages, anything
-- they sent, and anything addressed to them.

CREATE TABLE IF NOT EXISTS public.crew_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL,
  project_id          uuid NOT NULL REFERENCES public.crew_projects(id) ON DELETE CASCADE,
  from_contractor_id  uuid REFERENCES public.contractors(id) ON DELETE CASCADE,
  to_contractor_id    uuid REFERENCES public.contractors(id) ON DELETE CASCADE,
  to_office           boolean NOT NULL DEFAULT false,
  content             text NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 4000),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (to_office AND to_contractor_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS crew_messages_project_idx ON public.crew_messages (project_id, created_at);

ALTER TABLE public.crew_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crew_messages_owner ON public.crew_messages;
CREATE POLICY crew_messages_owner ON public.crew_messages FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Projects the caller leads at least one team on.
CREATE OR REPLACE FUNCTION public.crew_tech_projects()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT DISTINCT p.id
  FROM crew_projects p
  JOIN crew_teams t ON t.project_id = p.id
  WHERE t.lead_contractor_id = (tech_ctx() ->> 'contractor_id')::uuid
    AND p.user_id = (tech_ctx() ->> 'owner_id')::uuid
    AND p.archived_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.crew_tech_projects() FROM PUBLIC, anon, authenticated;

-- The whole board for the caller's projects: weeks, teams (names and lead
-- names only), every site and who has it. No rates, no money, no contact info.
CREATE OR REPLACE FUNCTION public.tech_crew_board()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'client', p.client,
      'start_date', p.start_date, 'weeks', p.weeks, 'skip_weeks', p.skip_weeks,
      'my_team_ids', (SELECT COALESCE(jsonb_agg(t.id), '[]'::jsonb) FROM crew_teams t
                       WHERE t.project_id = p.id AND t.lead_contractor_id = (v_ctx ->> 'contractor_id')::uuid),
      'teams', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', t.id, 'name', t.name, 'lead_name', c.name, 'lead_id', t.lead_contractor_id
                ) ORDER BY t.sort, t.name), '[]'::jsonb)
                FROM crew_teams t LEFT JOIN contractors c ON c.id = t.lead_contractor_id
                WHERE t.project_id = p.id),
      'sites', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', s.id, 'name', s.name, 'address', s.address, 'city', s.city, 'state', s.state,
                  'team_id', s.team_id, 'week_start', s.week_start, 'status', s.status
                ) ORDER BY s.state, s.city, s.name), '[]'::jsonb)
                FROM crew_sites s WHERE s.project_id = p.id)
    ) ORDER BY p.start_date)
    FROM crew_projects p
    WHERE p.id IN (SELECT crew_tech_projects())
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_crew_claim_site(p_site uuid, p_week date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx  jsonb := tech_ctx();
  v_site crew_sites%ROWTYPE;
  v_proj crew_projects%ROWTYPE;
  v_team uuid;
  v_monday date;
  v_first date;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;

  -- Lock the row so two leads tapping the same site at once cannot both win.
  SELECT * INTO v_site FROM crew_sites WHERE id = p_site FOR UPDATE;
  IF NOT FOUND OR v_site.project_id NOT IN (SELECT crew_tech_projects()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  SELECT * INTO v_proj FROM crew_projects WHERE id = v_site.project_id;

  SELECT id INTO v_team FROM crew_teams
   WHERE project_id = v_proj.id AND lead_contractor_id = (v_ctx ->> 'contractor_id')::uuid
   ORDER BY sort LIMIT 1;

  IF v_site.team_id IS NOT NULL AND v_site.team_id <> v_team THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'taken');
  END IF;
  IF v_site.status NOT IN ('planned','scheduled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'started');
  END IF;

  -- The week must be one of the project's Mondays and not a holiday week.
  v_monday := p_week - ((extract(isodow FROM p_week)::int) - 1);
  v_first  := v_proj.start_date - ((extract(isodow FROM v_proj.start_date)::int) - 1);
  IF v_proj.start_date IS NULL OR v_monday < v_first
     OR v_monday >= v_first + (v_proj.weeks * 7)
     OR v_monday = ANY (SELECT d - ((extract(isodow FROM d)::int) - 1) FROM unnest(v_proj.skip_weeks) d) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_week');
  END IF;

  IF EXISTS (SELECT 1 FROM crew_sites
              WHERE team_id = v_team AND week_start = v_monday AND id <> p_site) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'week_full');
  END IF;

  UPDATE crew_sites
     SET team_id = v_team, week_start = v_monday, status = 'scheduled', updated_at = now()
   WHERE id = p_site;
  RETURN jsonb_build_object('ok', true, 'reason', 'claimed');
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_crew_release_site(p_site uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_site crew_sites%ROWTYPE;
BEGIN
  IF crew_tech_site_team(p_site) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_your_site');
  END IF;
  SELECT * INTO v_site FROM crew_sites WHERE id = p_site FOR UPDATE;
  IF v_site.status NOT IN ('planned','scheduled')
     OR EXISTS (SELECT 1 FROM crew_time_entries WHERE site_id = p_site)
     OR EXISTS (SELECT 1 FROM crew_receipts WHERE site_id = p_site) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'started');
  END IF;
  UPDATE crew_sites SET team_id = NULL, week_start = NULL, status = 'planned', updated_at = now()
   WHERE id = p_site;
  RETURN jsonb_build_object('ok', true, 'reason', 'released');
END;
$$;

-- The channel as the caller is allowed to see it, oldest first.
CREATE OR REPLACE FUNCTION public.tech_crew_messages(p_project uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_me  uuid;
BEGIN
  IF v_ctx IS NULL OR p_project NOT IN (SELECT crew_tech_projects()) THEN RETURN '[]'::jsonb; END IF;
  v_me := (v_ctx ->> 'contractor_id')::uuid;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'content', m.content, 'created_at', m.created_at,
      'from_id', m.from_contractor_id, 'from_name', COALESCE(f.name, 'Fred (office)'),
      'to_id', m.to_contractor_id, 'to_name', t.name, 'to_office', m.to_office,
      'mine', m.from_contractor_id = v_me
    ) ORDER BY m.created_at)
    FROM (
      SELECT * FROM crew_messages
       WHERE project_id = p_project
         AND ((to_contractor_id IS NULL AND NOT to_office)
              OR from_contractor_id = v_me
              OR to_contractor_id = v_me)
       ORDER BY created_at DESC
       LIMIT 300
    ) m
    LEFT JOIN contractors f ON f.id = m.from_contractor_id
    LEFT JOIN contractors t ON t.id = m.to_contractor_id
  ), '[]'::jsonb);
END;
$$;

-- p_to: NULL = everyone; 'office' = Fred only; otherwise a lead's contractor id
-- on the same project.
CREATE OR REPLACE FUNCTION public.tech_crew_send(p_project uuid, p_to text, p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_to  uuid;
BEGIN
  IF v_ctx IS NULL OR p_project NOT IN (SELECT crew_tech_projects()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty');
  END IF;
  IF p_to IS NOT NULL AND p_to <> 'office' THEN
    v_to := p_to::uuid;
    IF NOT EXISTS (SELECT 1 FROM crew_teams WHERE project_id = p_project AND lead_contractor_id = v_to) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
  END IF;
  INSERT INTO crew_messages (user_id, project_id, from_contractor_id, to_contractor_id, to_office, content)
  VALUES ((v_ctx ->> 'owner_id')::uuid, p_project, (v_ctx ->> 'contractor_id')::uuid,
          v_to, COALESCE(p_to = 'office', false), left(trim(p_content), 4000));
  RETURN jsonb_build_object('ok', true, 'reason', 'sent');
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.tech_crew_board(), public.tech_crew_claim_site(uuid, date),
  public.tech_crew_release_site(uuid), public.tech_crew_messages(uuid),
  public.tech_crew_send(uuid, text, text)
TO authenticated;
REVOKE EXECUTE ON FUNCTION
  public.tech_crew_board(), public.tech_crew_claim_site(uuid, date),
  public.tech_crew_release_site(uuid), public.tech_crew_messages(uuid),
  public.tech_crew_send(uuid, text, text)
FROM anon;
