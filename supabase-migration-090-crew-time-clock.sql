-- Migration 090: crew time clock — sign in, breaks, meals, sign out.
--
-- A crew site runs several days. Each day the lead taps Sign in on arrival,
-- Break / Meal start and end through the day, and Sign out when they leave.
-- Every tap is a row in crew_punches (with the phone's location when given).
-- The day's crew_time_entries row is rebuilt from the punches on every tap:
--   on-site time  = first sign-in → last sign-out (or → now while open)
--   paid hours    = on-site minus meals (and minus breaks if the project says so)
-- Typed-in days still work as before; a day that has punches is owned by the
-- clock, so a lead cannot type over it.
--
-- Defaults follow the usual rule: meals are unpaid, short breaks are paid.
-- Both are per-project switches Fred controls.

ALTER TABLE public.crew_projects
  ADD COLUMN IF NOT EXISTS deduct_meals  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deduct_breaks boolean NOT NULL DEFAULT false;

ALTER TABLE public.crew_time_entries
  ADD COLUMN IF NOT EXISTS break_minutes int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meal_minutes  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS from_clock    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS open_since    timestamptz;   -- set while signed in, cleared at sign out

-- The clock writes a 0-hour row the moment someone signs in.
ALTER TABLE public.crew_time_entries DROP CONSTRAINT IF EXISTS crew_time_entries_hours_check;
ALTER TABLE public.crew_time_entries ADD CONSTRAINT crew_time_entries_hours_check CHECK (hours >= 0 AND hours <= 16);

CREATE TABLE IF NOT EXISTS public.crew_punches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  site_id     uuid NOT NULL REFERENCES public.crew_sites(id) ON DELETE CASCADE,
  team_id     uuid NOT NULL REFERENCES public.crew_teams(id) ON DELETE CASCADE,
  work_date   date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('in','out','break_start','break_end','meal_start','meal_end')),
  at          timestamptz NOT NULL DEFAULT now(),
  lat         double precision,
  lng         double precision,
  entered_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crew_punches_day_idx ON public.crew_punches (site_id, work_date, at);

ALTER TABLE public.crew_punches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crew_punches_owner ON public.crew_punches;
CREATE POLICY crew_punches_owner ON public.crew_punches FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Where the day stands: 'off' (not signed in or signed out), 'on', 'break', 'meal'.
CREATE OR REPLACE FUNCTION public.crew_day_state(p_site uuid, p_date date)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT CASE (SELECT kind FROM crew_punches WHERE site_id = p_site AND work_date = p_date
                ORDER BY at DESC, created_at DESC LIMIT 1)
           WHEN 'in' THEN 'on' WHEN 'break_end' THEN 'on' WHEN 'meal_end' THEN 'on'
           WHEN 'break_start' THEN 'break' WHEN 'meal_start' THEN 'meal'
           ELSE 'off' END;
$$;
REVOKE ALL ON FUNCTION public.crew_day_state(uuid, date) FROM PUBLIC, anon, authenticated;

-- Rebuild one day's timecard from its punches.
CREATE OR REPLACE FUNCTION public.crew_rebuild_day(p_site uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_site   crew_sites%ROWTYPE;
  v_proj   crew_projects%ROWTYPE;
  v_first  timestamptz;
  v_last_out timestamptz;
  v_end    timestamptz;
  v_state  text;
  v_break  numeric := 0;
  v_meal   numeric := 0;
  v_open   timestamptz;
  v_kind   text;
  p        record;
  v_mins   numeric;
  v_hours  numeric;
  v_team   uuid;
  v_who    text;
BEGIN
  SELECT * INTO v_site FROM crew_sites WHERE id = p_site;
  SELECT * INTO v_proj FROM crew_projects WHERE id = v_site.project_id;
  v_state := crew_day_state(p_site, p_date);

  SELECT min(at) INTO v_first FROM crew_punches WHERE site_id = p_site AND work_date = p_date AND kind = 'in';
  IF v_first IS NULL THEN RETURN; END IF;
  SELECT max(at) INTO v_last_out FROM crew_punches WHERE site_id = p_site AND work_date = p_date AND kind = 'out';
  v_end := CASE WHEN v_state = 'off' AND v_last_out IS NOT NULL THEN v_last_out ELSE now() END;

  -- Walk the punches pairing starts with ends; an open break/meal runs to v_end.
  v_open := NULL; v_kind := NULL;
  FOR p IN SELECT kind, at FROM crew_punches WHERE site_id = p_site AND work_date = p_date ORDER BY at, created_at LOOP
    IF p.kind IN ('break_start','meal_start') AND v_open IS NULL THEN
      v_open := p.at; v_kind := p.kind;
    ELSIF p.kind IN ('break_end','meal_end','out') AND v_open IS NOT NULL THEN
      IF v_kind = 'break_start' THEN v_break := v_break + extract(epoch FROM p.at - v_open) / 60;
      ELSE v_meal := v_meal + extract(epoch FROM p.at - v_open) / 60; END IF;
      v_open := NULL; v_kind := NULL;
    END IF;
  END LOOP;
  IF v_open IS NOT NULL THEN
    IF v_kind = 'break_start' THEN v_break := v_break + extract(epoch FROM v_end - v_open) / 60;
    ELSE v_meal := v_meal + extract(epoch FROM v_end - v_open) / 60; END IF;
  END IF;

  v_mins := extract(epoch FROM v_end - v_first) / 60
            - CASE WHEN v_proj.deduct_meals THEN v_meal ELSE 0 END
            - CASE WHEN v_proj.deduct_breaks THEN v_break ELSE 0 END;
  v_hours := least(16, greatest(0, round(v_mins / 60.0 * 4) / 4));   -- nearest quarter hour

  SELECT team_id, entered_by INTO v_team, v_who FROM crew_punches
   WHERE site_id = p_site AND work_date = p_date ORDER BY at DESC LIMIT 1;

  INSERT INTO crew_time_entries (user_id, site_id, team_id, work_date, start_time, end_time, hours,
                                 helper_present, status, entered_by, break_minutes, meal_minutes,
                                 from_clock, open_since)
  VALUES (v_proj.user_id, p_site, v_team, p_date,
          (v_first AT TIME ZONE 'America/New_York')::time,
          CASE WHEN v_state = 'off' THEN (v_last_out AT TIME ZONE 'America/New_York')::time END,
          v_hours, true, 'submitted', v_who, round(v_break), round(v_meal),
          true, CASE WHEN v_state = 'off' THEN NULL ELSE v_first END)
  ON CONFLICT (site_id, work_date) DO UPDATE
    SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, hours = EXCLUDED.hours,
        break_minutes = EXCLUDED.break_minutes, meal_minutes = EXCLUDED.meal_minutes,
        from_clock = true, open_since = EXCLUDED.open_since, entered_by = EXCLUDED.entered_by,
        status = CASE WHEN crew_time_entries.status = 'approved' THEN 'approved' ELSE 'submitted' END,
        updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.crew_rebuild_day(uuid, date) FROM PUBLIC, anon, authenticated;

-- One tap on the lead's phone. Only the next sensible tap is accepted, so a
-- double-tap or a stray button cannot scramble the day.
CREATE OR REPLACE FUNCTION public.tech_crew_punch(
  p_site uuid, p_kind text, p_lat double precision, p_lng double precision
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_team  uuid;
  v_date  date := (now() AT TIME ZONE 'America/New_York')::date;
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

  -- Signing out in the middle of a break or meal closes it at the same moment.
  IF p_kind = 'out' AND v_state IN ('break','meal') THEN
    INSERT INTO crew_punches (user_id, site_id, team_id, work_date, kind, lat, lng, entered_by)
    VALUES ((v_ctx ->> 'owner_id')::uuid, p_site, v_team, v_date,
            CASE v_state WHEN 'break' THEN 'break_end' ELSE 'meal_end' END, p_lat, p_lng, v_ctx ->> 'contractor_name');
  END IF;

  INSERT INTO crew_punches (user_id, site_id, team_id, work_date, kind, lat, lng, entered_by)
  VALUES ((v_ctx ->> 'owner_id')::uuid, p_site, v_team, v_date, p_kind, p_lat, p_lng, v_ctx ->> 'contractor_name');

  PERFORM crew_rebuild_day(p_site, v_date);
  UPDATE crew_sites SET status = 'in_progress', updated_at = now()
   WHERE id = p_site AND status IN ('planned','scheduled');

  RETURN jsonb_build_object('ok', true, 'reason', 'saved', 'state', crew_day_state(p_site, v_date));
END;
$$;

-- Today's punches on one site, and where the day stands.
CREATE OR REPLACE FUNCTION public.tech_crew_today(p_site uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE
  v_date date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF crew_tech_site_team(p_site) IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'work_date', v_date,
    'state', crew_day_state(p_site, v_date),
    'punches', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'at', at) ORDER BY at, created_at)
                          FROM crew_punches WHERE site_id = p_site AND work_date = v_date), '[]'::jsonb),
    'entry', (SELECT jsonb_build_object('hours', hours, 'break_minutes', break_minutes,
                                        'meal_minutes', meal_minutes, 'status', status)
                FROM crew_time_entries WHERE site_id = p_site AND work_date = v_date)
  );
END;
$$;

-- A day driven by the clock cannot be typed over from the phone.
CREATE OR REPLACE FUNCTION public.tech_crew_log_time(
  p_site uuid, p_date date, p_start time, p_end time, p_hours numeric,
  p_helper boolean, p_note text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx  jsonb := tech_ctx();
  v_team uuid;
  v_existing record;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  v_team := crew_tech_site_team(p_site);
  IF v_team IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_your_site'); END IF;
  IF p_date IS NULL OR p_date > current_date + 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_date');
  END IF;

  SELECT id, status, from_clock INTO v_existing FROM crew_time_entries WHERE site_id = p_site AND work_date = p_date;
  IF FOUND AND v_existing.status = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_approved');
  END IF;

  -- On a clocked day the lead may still set the helper flag and a note.
  IF FOUND AND v_existing.from_clock THEN
    UPDATE crew_time_entries
       SET helper_present = COALESCE(p_helper, helper_present),
           note = COALESCE(NULLIF(trim(p_note), ''), note), updated_at = now()
     WHERE id = v_existing.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'saved');
  END IF;

  IF p_hours IS NULL OR p_hours <= 0 OR p_hours > 16 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_hours');
  END IF;

  INSERT INTO crew_time_entries (user_id, site_id, team_id, work_date, start_time, end_time,
                                 hours, helper_present, note, status, entered_by)
  VALUES ((v_ctx ->> 'owner_id')::uuid, p_site, v_team, p_date, p_start, p_end,
          round(p_hours, 2), COALESCE(p_helper, true), NULLIF(trim(p_note), ''), 'submitted',
          v_ctx ->> 'contractor_name')
  ON CONFLICT (site_id, work_date) DO UPDATE
    SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
        hours = EXCLUDED.hours, helper_present = EXCLUDED.helper_present,
        note = EXCLUDED.note, status = 'submitted',
        entered_by = EXCLUDED.entered_by, updated_at = now();

  UPDATE crew_sites SET status = 'in_progress', updated_at = now()
   WHERE id = p_site AND status IN ('planned','scheduled');
  RETURN jsonb_build_object('ok', true, 'reason', 'saved');
END;
$$;

-- tech_crew_time now also returns the clock fields.
CREATE OR REPLACE FUNCTION public.tech_crew_time()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', e.id, 'site_id', e.site_id, 'work_date', e.work_date,
             'start_time', e.start_time, 'end_time', e.end_time, 'hours', e.hours,
             'helper_present', e.helper_present, 'note', e.note, 'status', e.status,
             'break_minutes', e.break_minutes, 'meal_minutes', e.meal_minutes,
             'from_clock', e.from_clock, 'open_since', e.open_since
           ) ORDER BY e.work_date DESC)
    FROM crew_time_entries e
    JOIN crew_teams t ON t.id = e.team_id
    JOIN crew_projects p ON p.id = t.project_id
    WHERE t.lead_contractor_id = (v_ctx ->> 'contractor_id')::uuid
      AND p.user_id = (v_ctx ->> 'owner_id')::uuid
      AND p.archived_at IS NULL
  ), '[]'::jsonb);
END;
$$;

-- Deleting a clocked day also clears its punches.
CREATE OR REPLACE FUNCTION public.tech_crew_delete_time(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row record;
BEGIN
  SELECT * INTO v_row FROM crew_time_entries WHERE id = p_id;
  IF NOT FOUND OR crew_tech_site_team(v_row.site_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_row.status = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_approved');
  END IF;
  DELETE FROM crew_punches WHERE site_id = v_row.site_id AND work_date = v_row.work_date;
  DELETE FROM crew_time_entries WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'reason', 'deleted');
END;
$$;

GRANT EXECUTE ON FUNCTION public.tech_crew_punch(uuid, text, double precision, double precision),
                          public.tech_crew_today(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.tech_crew_punch(uuid, text, double precision, double precision),
                           public.tech_crew_today(uuid) FROM anon;
