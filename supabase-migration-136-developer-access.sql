-- Migration 136: a developer login that sees and does everything the owner does.
--
-- Fred, 2026-10-20: "Ashley give her both developer on the technician and admin
-- side. Developer have access to everything. Only for Ashley." 2026-10-23:
-- "Live … Fred owner Ashley developer."
--
-- The office app was the owner's alone: every row, file and office function is
-- keyed to the signed-in id. A developer login acts for the owner instead.
--
--   staff_members.role 'developer'  the person. Added by hand, never from the
--                                   Team screen (owner_staff_add still refuses
--                                   it). Fred switches it off or removes it there.
--   acting_owner()                  the owner a login acts for: the owner, for an
--                                   enabled developer; anyone else, themselves.
--                                   So nothing changes for Fred, techs,
--                                   assistants or the accountant.
--   access rules                    every rule that said "the signed-in id" now
--                                   says acting_owner(), on tables and files.
--                                   Phone pop-up subscriptions stay each login's own.
--   office functions                the same. Staff management stays Fred's
--                                   alone. wf_role() calls a developer the owner,
--                                   so the office app opens for her.
--   new rows                        filed under the owner (stamp_acting_owner).
--   delegate_activity               every change a developer makes, with her
--                                   name, readable by the owner only.

-- ── The role ────────────────────────────────────────────────────────────────

ALTER TABLE public.staff_members DROP CONSTRAINT IF EXISTS staff_members_role_check;
ALTER TABLE public.staff_members ADD CONSTRAINT staff_members_role_check
  CHECK (staff_role_allowed(role) OR role = 'developer');

-- ── Who a login acts for ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.acting_owner()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT s.owner_id FROM staff_members s
      WHERE s.auth_user_id = auth.uid() AND s.enabled AND s.role = 'developer' AND s.owner_id <> auth.uid()
      ORDER BY s.created_at LIMIT 1),
    auth.uid());
$$;
REVOKE ALL ON FUNCTION public.acting_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acting_owner() TO anon, authenticated, service_role;

-- ── The developer's changes, for the owner ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.delegate_activity (
  id          bigserial PRIMARY KEY,
  owner_id    uuid NOT NULL,
  actor_id    uuid NOT NULL,
  actor_name  text,
  table_name  text NOT NULL,
  row_id      text,
  action      text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delegate_activity_owner_idx ON public.delegate_activity (owner_id, at DESC);
ALTER TABLE public.delegate_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delegate_activity FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.delegate_activity FROM authenticated;

CREATE OR REPLACE FUNCTION public.log_delegate_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_owner uuid := public.acting_owner();
  v_row   jsonb;
BEGIN
  IF v_owner IS NULL OR v_owner = auth.uid() THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
  INSERT INTO delegate_activity (owner_id, actor_id, actor_name, table_name, row_id, action)
  VALUES (v_owner, auth.uid(),
          (SELECT name FROM staff_members WHERE auth_user_id = auth.uid() ORDER BY created_at LIMIT 1),
          TG_TABLE_NAME, v_row ->> 'id', lower(TG_OP));
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL; -- the log never blocks the change
END;
$$;

-- A developer's new rows belong to the owner, whatever id the app sent.
CREATE OR REPLACE FUNCTION public.stamp_acting_owner()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  v_owner uuid := public.acting_owner();
  v_cur   text;
BEGIN
  IF v_owner IS NULL OR v_owner = auth.uid() THEN RETURN NEW; END IF;
  v_cur := to_jsonb(NEW) ->> TG_ARGV[0];
  IF v_cur IS NULL OR v_cur = auth.uid()::text THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], v_owner));
  END IF;
  RETURN NEW;
END;
$$;

-- ── Every "signed-in id" access rule acts for the owner ─────────────────────

DO $$
DECLARE
  p     record;
  v_sql text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies
     WHERE schemaname IN ('public', 'storage')
       AND (coalesce(qual, '') LIKE '%auth.uid()%' OR coalesce(with_check, '') LIKE '%auth.uid()%')
       AND NOT (schemaname = 'public' AND tablename IN ('push_subscriptions', 'delegate_activity'))
  LOOP
    v_sql := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF p.qual IS NOT NULL THEN
      v_sql := v_sql || ' USING (' || replace(p.qual, 'auth.uid()', '(SELECT public.acting_owner())') || ')';
    END IF;
    IF p.with_check IS NOT NULL THEN
      v_sql := v_sql || ' WITH CHECK (' || replace(p.with_check, 'auth.uid()', '(SELECT public.acting_owner())') || ')';
    END IF;
    EXECUTE v_sql;
  END LOOP;
END $$;

-- Read by the owner only (made after the loop, so it keeps auth.uid()).
DROP POLICY IF EXISTS delegate_activity_owner_read ON public.delegate_activity;
CREATE POLICY delegate_activity_owner_read ON public.delegate_activity FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

-- ── New rows and the change log, on every owner table ───────────────────────

DO $$
DECLARE
  t     record;
  v_col text;
BEGIN
  FOR t IN
    SELECT DISTINCT tablename FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual, '') LIKE '%acting_owner()%' OR coalesce(with_check, '') LIKE '%acting_owner()%')
       AND tablename NOT IN ('staff_members', 'delegate_activity')
  LOOP
    SELECT column_name INTO v_col FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t.tablename AND column_name IN ('user_id', 'owner_id')
     ORDER BY column_name = 'user_id' DESC LIMIT 1;
    IF v_col IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS a_stamp_acting_owner ON public.%I', t.tablename);
      EXECUTE format('CREATE TRIGGER a_stamp_acting_owner BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.stamp_acting_owner(%L)',
                     t.tablename, v_col);
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS zz_log_delegate_change ON public.%I', t.tablename);
    EXECUTE format('CREATE TRIGGER zz_log_delegate_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_delegate_change()',
                   t.tablename);
  END LOOP;
END $$;

-- ── Office functions act for the owner ──────────────────────────────────────
-- Their live definitions, with "the signed-in id" read as the owner. Staff
-- management (owner_staff_*) and the tech and staff sign-in functions are left
-- as they are.

DO $$
DECLARE
  f     record;
  v_def text;
  v_new text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('owner_inbox', 'owner_inbox_set_query', 'owner_job_email_set_status',
                         'wf_owner_add_expense', 'wf_owner_decide_expense', 'wf_owner_remove_expense',
                         'wf_set_task', 'wf_create_job', 'wf_set_techs', 'project_sheet_token', 'wf_role')
  LOOP
    v_def := pg_get_functiondef(f.oid);
    -- wf_role keeps the developer's own name; only the owner check acts for the owner.
    v_new := CASE WHEN f.proname = 'wf_role'
                  THEN replace(v_def, 'is_business_owner(auth.uid())', 'is_business_owner(public.acting_owner())')
                  ELSE replace(v_def, 'auth.uid()', 'public.acting_owner()') END;
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END $$;

-- Who is the developer is set by hand on the live database, not here:
--   INSERT INTO public.staff_members (owner_id, name, email, role, auth_user_id)
--   VALUES ('<owner id>', '<name>', '<login email>', 'developer', '<their auth user id>');
