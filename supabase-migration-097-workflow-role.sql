-- Migration 097: who is signing in to WorkFlow.
--
-- WorkFlow shows a tech their own jobs and the owner every job, so the first
-- thing it asks after sign-in is which of the two this login is. The answer
-- comes from the same functions every other section trusts:
--
--   tech     a linked, enabled contractor login of someone else's business
--            (tech_ctx, migration-067). Checked first: Fred's own tech login is
--            a tech here, exactly as in the tech portal.
--   owner    a login that owns the books (is_business_owner, migration-092)
--   staff    an assistant or accountant: they work in the web app, not here
--   none     anyone else, including a tech whose login is not linked yet
--            (WorkFlow then tries tech_claim_account once and asks again)

CREATE OR REPLACE FUNCTION public.wf_role()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE
  v_t jsonb;
  v_s jsonb;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('role', 'none'); END IF;

  v_t := tech_ctx();
  IF v_t IS NOT NULL AND (v_t ->> 'owner_id')::uuid <> auth.uid() THEN
    RETURN jsonb_build_object('role', 'tech', 'name', v_t ->> 'contractor_name');
  END IF;

  IF is_business_owner(auth.uid()) THEN
    SELECT COALESCE(NULLIF(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1))
      INTO v_name FROM auth.users u WHERE u.id = auth.uid();
    RETURN jsonb_build_object('role', 'owner', 'name', v_name);
  END IF;

  v_s := staff_ctx();
  IF v_s IS NOT NULL THEN
    RETURN jsonb_build_object('role', 'staff', 'name', v_s ->> 'name', 'staff_role', v_s ->> 'role');
  END IF;

  RETURN jsonb_build_object('role', 'none');
END;
$$;

REVOKE ALL ON FUNCTION public.wf_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_role() TO authenticated;
