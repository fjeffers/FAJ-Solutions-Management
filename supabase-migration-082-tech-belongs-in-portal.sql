-- 082: a tech login belongs in the tech portal, not the owner app.
--
-- On 2026-08-30 Fred was signed in as his own tech login and converted a site
-- visit from the main app. Both records were filed under that account and
-- became invisible twice over: RLS hid them from the owner app, and
-- tech_my_jobs skips jobs whose owner is not the business owner, so the tech
-- portal skipped them too. The job showed "assigned and accepted" and appeared
-- nowhere. It could not even change status.
--
-- The login page already sent a tech to /tech after signing in. The gap was an
-- existing session: opening the app root with a tech session already active
-- handed over the full owner UI, and everything created there went to the
-- wrong account.
--
-- This answers the one question the app root needs to ask.
--
-- Deliberately three-way, so the owner can never be shut out of their own app:
--
--   not a contractor at all          -> false, stay (the ordinary owner)
--   a contractor who owns the business -> false, stay (Fred is on his own jobs)
--   a contractor of someone else's    -> TRUE, send them to /tech
--
-- The middle case is the one that matters. Fred appears as a contractor on his
-- own work orders, and if that alone redirected him he would lose the app.

CREATE OR REPLACE FUNCTION public.belongs_in_tech_portal()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx();
BEGIN
  -- Not signed in, or not a portal-enabled contractor: not our business.
  IF v_ctx IS NULL THEN RETURN false; END IF;
  -- A contractor who is also the owner of the business stays in the owner app.
  IF (v_ctx->>'owner_id')::uuid = auth.uid() THEN RETURN false; END IF;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.belongs_in_tech_portal() TO authenticated, anon;
