-- Migration 087: crew projects — multi-team T&M jobs (first use: the LDS
-- meetinghouse refresh FAJ runs for NetView).
--
-- Deliberately SEPARATE from work_orders. A crew site is billed by the hour
-- per team and paid out to a lead, which is a different money model from a
-- work order's total_amount / contractor_pay split. Folding it into
-- work_orders would mean a null contractor_pay reads as "tech gets the full
-- price" (the legacy rule in lib/utils.ts) — exactly the kind of quiet money
-- error this app has been bitten by before.
--
--   crew_projects      one job, e.g. "LDS Meetinghouse Refresh" for NetView
--   crew_teams         a lead (a contractor with a portal login) + helper name,
--                      and pay_rate: what FAJ pays the lead per team-hour.
--                      The lead pays their own helper out of that.
--   crew_sites         a meetinghouse; scheduled to one team for one week
--   crew_time_entries  one row per site per day, logged by the lead for the team
--   crew_receipts      travel receipts; file in the private crew-receipts bucket
--   crew_payments      money out to a lead ('to_lead') or in from the client
--                      ('from_client')
--
-- Owner access is plain RLS on user_id. Techs NEVER touch these tables
-- directly: every read and write goes through a tech_crew_* SECURITY DEFINER
-- function that resolves the caller with tech_ctx() and only returns what
-- belongs to teams they lead. No bill rate, pay rate or margin is ever
-- returned to a tech.

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crew_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL DEFAULT auth.uid(),
  name          text NOT NULL,
  client        text,
  bill_rate     numeric(10,2) NOT NULL DEFAULT 90,     -- client pays per team-hour
  travel_cap    numeric(10,2) NOT NULL DEFAULT 3000,   -- reimbursable travel per site
  start_date    date,                                  -- Monday of week 1
  weeks         int NOT NULL DEFAULT 7 CHECK (weeks BETWEEN 1 AND 52),
  skip_weeks    date[] NOT NULL DEFAULT '{}',          -- Mondays with no work (holidays)
  notes         text,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crew_teams (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL DEFAULT auth.uid(),
  project_id          uuid NOT NULL REFERENCES public.crew_projects(id) ON DELETE CASCADE,
  lead_contractor_id  uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  name                text NOT NULL,                     -- "Team 1 — Fred"
  helper_name         text,
  pay_rate            numeric(10,2) NOT NULL DEFAULT 0,  -- FAJ pays the lead per team-hour
  sort                int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crew_sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid(),
  project_id  uuid NOT NULL REFERENCES public.crew_projects(id) ON DELETE CASCADE,
  team_id     uuid REFERENCES public.crew_teams(id) ON DELETE SET NULL,
  week_start  date,                                      -- Monday of the scheduled week
  name        text NOT NULL,
  address     text,
  city        text,
  state       text,
  status      text NOT NULL DEFAULT 'planned'
              CHECK (status IN ('planned','scheduled','in_progress','done','deliverables_in','audited')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crew_time_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,                          -- the owner (Fred), always
  site_id        uuid NOT NULL REFERENCES public.crew_sites(id) ON DELETE CASCADE,
  team_id        uuid NOT NULL REFERENCES public.crew_teams(id) ON DELETE CASCADE,
  work_date      date NOT NULL,
  start_time     time,
  end_time       time,
  hours          numeric(5,2) NOT NULL CHECK (hours > 0 AND hours <= 16),
  helper_present boolean NOT NULL DEFAULT true,
  note           text,
  status         text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected')),
  entered_by     text,                                   -- contractor name, or 'office'
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, work_date)
);

CREATE TABLE IF NOT EXISTS public.crew_receipts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  site_id       uuid NOT NULL REFERENCES public.crew_sites(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES public.crew_teams(id) ON DELETE CASCADE,
  receipt_date  date NOT NULL,
  category      text NOT NULL DEFAULT 'other' CHECK (category IN ('hotel','fuel','meals','tolls','parking','other')),
  vendor        text,
  amount        numeric(10,2) NOT NULL CHECK (amount > 0 AND amount < 10000),
  file_path     text,                                    -- object path in crew-receipts
  note          text,
  status        text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected','reimbursed')),
  entered_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crew_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid(),
  project_id  uuid NOT NULL REFERENCES public.crew_projects(id) ON DELETE CASCADE,
  team_id     uuid REFERENCES public.crew_teams(id) ON DELETE SET NULL,   -- null for from_client
  direction   text NOT NULL CHECK (direction IN ('to_lead','from_client')),
  kind        text NOT NULL DEFAULT 'labor' CHECK (kind IN ('labor','travel')),
  amount      numeric(10,2) NOT NULL CHECK (amount > 0),
  paid_on     date NOT NULL DEFAULT current_date,
  method      text,
  reference   text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (direction = 'from_client' OR team_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS crew_teams_project_idx   ON public.crew_teams (project_id);
CREATE INDEX IF NOT EXISTS crew_teams_lead_idx      ON public.crew_teams (lead_contractor_id);
CREATE INDEX IF NOT EXISTS crew_sites_project_idx   ON public.crew_sites (project_id);
CREATE INDEX IF NOT EXISTS crew_sites_team_idx      ON public.crew_sites (team_id);
CREATE INDEX IF NOT EXISTS crew_time_site_idx       ON public.crew_time_entries (site_id);
CREATE INDEX IF NOT EXISTS crew_time_team_idx       ON public.crew_time_entries (team_id);
CREATE INDEX IF NOT EXISTS crew_receipts_site_idx   ON public.crew_receipts (site_id);
CREATE INDEX IF NOT EXISTS crew_payments_project_idx ON public.crew_payments (project_id);

-- ── Owner RLS ───────────────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crew_projects','crew_teams','crew_sites','crew_time_entries','crew_receipts','crew_payments']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())',
      t || '_owner', t);
  END LOOP;
END $$;

-- ── Tech-side helpers ───────────────────────────────────────────────────────

-- The caller's contractor id as text: the folder their receipt photos live
-- under. NULL for anyone who is not a linked, enabled tech.
CREATE OR REPLACE FUNCTION public.crew_tech_folder()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT (tech_ctx() ->> 'contractor_id');
$$;

-- Is this site on a team the caller leads? Returns the team id, or NULL.
CREATE OR REPLACE FUNCTION public.crew_tech_site_team(p_site uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT t.id
  FROM crew_sites s
  JOIN crew_teams t ON t.id = s.team_id
  JOIN crew_projects p ON p.id = s.project_id
  WHERE s.id = p_site
    AND t.lead_contractor_id = (tech_ctx() ->> 'contractor_id')::uuid
    AND p.user_id = (tech_ctx() ->> 'owner_id')::uuid
    AND p.archived_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.crew_tech_site_team(uuid) FROM PUBLIC, anon, authenticated;

-- Sites the caller leads, with this site's travel spend against the cap.
-- No rates, no money other than their own receipts.
CREATE OR REPLACE FUNCTION public.tech_crew_sites()
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
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.week_start NULLS LAST, x.name)
    FROM (
      SELECT s.id, s.name, s.address, s.city, s.state, s.week_start, s.status, s.notes,
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

CREATE OR REPLACE FUNCTION public.tech_crew_time()
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
             'id', e.id, 'site_id', e.site_id, 'work_date', e.work_date,
             'start_time', e.start_time, 'end_time', e.end_time, 'hours', e.hours,
             'helper_present', e.helper_present, 'note', e.note, 'status', e.status
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

-- Log (or correct) one day on one site. One row per site per day; an
-- approved day is locked so a lead cannot change hours after Fred signed off.
CREATE OR REPLACE FUNCTION public.tech_crew_log_time(
  p_site uuid, p_date date, p_start time, p_end time, p_hours numeric,
  p_helper boolean, p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  IF p_hours IS NULL OR p_hours <= 0 OR p_hours > 16 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_hours');
  END IF;

  SELECT id, status INTO v_existing FROM crew_time_entries WHERE site_id = p_site AND work_date = p_date;
  IF FOUND AND v_existing.status = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_approved');
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

  -- First hours on a scheduled site means the work has started.
  UPDATE crew_sites SET status = 'in_progress', updated_at = now()
   WHERE id = p_site AND status IN ('planned','scheduled');

  RETURN jsonb_build_object('ok', true, 'reason', 'saved');
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_crew_delete_time(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM crew_time_entries WHERE id = p_id;
  IF NOT FOUND OR crew_tech_site_team(v_row.site_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_row.status = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_approved');
  END IF;
  DELETE FROM crew_time_entries WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'reason', 'deleted');
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_crew_receipts()
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
             'id', r.id, 'site_id', r.site_id, 'receipt_date', r.receipt_date,
             'category', r.category, 'vendor', r.vendor, 'amount', r.amount,
             'file_path', r.file_path, 'note', r.note, 'status', r.status
           ) ORDER BY r.receipt_date DESC, r.created_at DESC)
    FROM crew_receipts r
    JOIN crew_teams t ON t.id = r.team_id
    JOIN crew_projects p ON p.id = t.project_id
    WHERE t.lead_contractor_id = (v_ctx ->> 'contractor_id')::uuid
      AND p.user_id = (v_ctx ->> 'owner_id')::uuid
      AND p.archived_at IS NULL
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_crew_add_receipt(
  p_site uuid, p_date date, p_category text, p_vendor text,
  p_amount numeric, p_path text, p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx  jsonb := tech_ctx();
  v_team uuid;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  v_team := crew_tech_site_team(p_site);
  IF v_team IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_your_site'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount >= 10000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount');
  END IF;
  IF p_category NOT IN ('hotel','fuel','meals','tolls','parking','other') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_category');
  END IF;
  -- The photo must sit in the caller's own folder, so a lead cannot attach
  -- someone else's upload to their claim.
  IF p_path IS NOT NULL AND split_part(p_path, '/', 1) <> (v_ctx ->> 'contractor_id') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_file');
  END IF;

  INSERT INTO crew_receipts (user_id, site_id, team_id, receipt_date, category, vendor,
                             amount, file_path, note, status, entered_by)
  VALUES ((v_ctx ->> 'owner_id')::uuid, p_site, v_team, COALESCE(p_date, current_date), p_category,
          NULLIF(trim(p_vendor), ''), round(p_amount, 2), p_path, NULLIF(trim(p_note), ''),
          'submitted', v_ctx ->> 'contractor_name');
  RETURN jsonb_build_object('ok', true, 'reason', 'saved');
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_crew_delete_receipt(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM crew_receipts WHERE id = p_id;
  IF NOT FOUND OR crew_tech_site_team(v_row.site_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_row.status <> 'submitted' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  END IF;
  DELETE FROM crew_receipts WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'reason', 'deleted', 'file_path', v_row.file_path);
END;
$$;

-- What FAJ has paid this lead on crew work. Their own payouts only.
CREATE OR REPLACE FUNCTION public.tech_crew_payments()
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
             'id', c.id, 'kind', c.kind, 'amount', c.amount, 'paid_on', c.paid_on,
             'method', c.method, 'note', c.note, 'project_name', p.name
           ) ORDER BY c.paid_on DESC)
    FROM crew_payments c
    JOIN crew_teams t ON t.id = c.team_id
    JOIN crew_projects p ON p.id = c.project_id
    WHERE c.direction = 'to_lead'
      AND t.lead_contractor_id = (v_ctx ->> 'contractor_id')::uuid
      AND p.user_id = (v_ctx ->> 'owner_id')::uuid
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.tech_crew_sites(), public.tech_crew_time(),
  public.tech_crew_log_time(uuid, date, time, time, numeric, boolean, text),
  public.tech_crew_delete_time(uuid), public.tech_crew_receipts(),
  public.tech_crew_add_receipt(uuid, date, text, text, numeric, text, text),
  public.tech_crew_delete_receipt(uuid), public.tech_crew_payments(),
  public.crew_tech_folder()
TO authenticated;
REVOKE EXECUTE ON FUNCTION
  public.tech_crew_sites(), public.tech_crew_time(),
  public.tech_crew_log_time(uuid, date, time, time, numeric, boolean, text),
  public.tech_crew_delete_time(uuid), public.tech_crew_receipts(),
  public.tech_crew_add_receipt(uuid, date, text, text, numeric, text, text),
  public.tech_crew_delete_receipt(uuid), public.tech_crew_payments(),
  public.crew_tech_folder()
FROM anon;

-- ── Receipt storage: private bucket ─────────────────────────────────────────
-- Path: <contractor_id>/<site_id>/<random>.<ext>. A tech writes and reads only
-- their own folder; the owner reads any file a receipt row of theirs names.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('crew-receipts', 'crew-receipts', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS crew_receipts_tech_insert ON storage.objects;
CREATE POLICY crew_receipts_tech_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crew-receipts'
              AND (storage.foldername(name))[1] = public.crew_tech_folder());

DROP POLICY IF EXISTS crew_receipts_tech_delete ON storage.objects;
CREATE POLICY crew_receipts_tech_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'crew-receipts'
         AND (storage.foldername(name))[1] = public.crew_tech_folder());

DROP POLICY IF EXISTS crew_receipts_read ON storage.objects;
CREATE POLICY crew_receipts_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'crew-receipts'
         AND ((storage.foldername(name))[1] = public.crew_tech_folder()
              OR EXISTS (SELECT 1 FROM public.crew_receipts r
                          WHERE r.file_path = storage.objects.name
                            AND r.user_id = auth.uid())));
