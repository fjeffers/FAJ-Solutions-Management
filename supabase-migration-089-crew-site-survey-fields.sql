-- Migration 089: crew sites carry NetView's Property ID, ZIP and survey date.
--
-- NetView's site sheets (Mike Wise, 2026-10-01) list every meetinghouse with a
-- Property ID, a survey date that comes weeks before cabling, and the cabling
-- week. The Property ID is how NetView refers to a site, so it is stored and
-- shown alongside the name. The tech RPCs are recreated to return the new
-- fields (still no rates or money).

ALTER TABLE public.crew_sites
  ADD COLUMN IF NOT EXISTS property_id text,
  ADD COLUMN IF NOT EXISTS zip         text,
  ADD COLUMN IF NOT EXISTS survey_date date;

CREATE OR REPLACE FUNCTION public.tech_crew_sites()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.week_start NULLS LAST, x.name)
    FROM (
      SELECT s.id, s.name, s.address, s.city, s.state, s.zip, s.property_id, s.survey_date,
             s.week_start, s.status, s.notes,
             p.name AS project_name, p.client, p.travel_cap,
             t.name AS team_name, t.helper_name,
             COALESCE((SELECT sum(r.amount) FROM crew_receipts r
                        WHERE r.site_id = s.id AND r.status <> 'rejected'), 0) AS travel_spent,
             COALESCE((SELECT sum(e.hours) FROM crew_time_entries e
                        WHERE e.site_id = s.id AND e.status <> 'rejected'), 0) AS hours_logged
      FROM crew_sites s
      JOIN crew_teams t ON t.id = s.team_id
      JOIN crew_projects p ON p.id = s.project_id
      WHERE t.lead_contractor_id = (v_ctx ->> 'contractor_id')::uuid
        AND p.user_id = (v_ctx ->> 'owner_id')::uuid
        AND p.archived_at IS NULL
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_crew_board()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx();
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
                  'zip', s.zip, 'property_id', s.property_id, 'survey_date', s.survey_date,
                  'team_id', s.team_id, 'week_start', s.week_start, 'status', s.status
                ) ORDER BY s.state, s.city, s.name), '[]'::jsonb)
                FROM crew_sites s WHERE s.project_id = p.id)
    ) ORDER BY p.start_date)
    FROM crew_projects p
    WHERE p.id IN (SELECT crew_tech_projects())
  ), '[]'::jsonb);
END;
$$;
