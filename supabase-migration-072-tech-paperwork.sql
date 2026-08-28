-- Migration 072: let a signed-in tech file their own W-9 and sign the agreement
--
-- Both flows already exist and are already hardened, but they are reached with
-- a portal TOKEN: portal_submit_w9_details and portal_submit_document validate
-- the TIN, refuse helper links, and write the tax ID to columns the portal
-- never reads back. A tech signed in at /tech has a session, not a token, so
-- none of it was reachable from the new portal.
--
-- The wrong fix would be a second SSN-handling path. Tax IDs and bank details
-- should travel through exactly one audited code path, not two.
--
-- So this exposes the caller's OWN portal token to their OWN authenticated
-- session, and the tech portal reuses the existing component and API route
-- unchanged. This grants nothing new: the token is that contractor's own
-- credential, already emailed to them, and it is returned only to a session
-- that tech_ctx() has already resolved to that same contractor.
--
-- Deliberately NOT exposed: any other contractor's token, and any token at all
-- to a caller who is not a linked, enabled tech.

CREATE OR REPLACE FUNCTION public.tech_portal_token()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_token uuid;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;

  SELECT c.portal_token INTO v_token
  FROM contractors c
  WHERE c.id = (v_ctx->>'contractor_id')::uuid;

  RETURN v_token::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.tech_portal_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tech_portal_token() TO authenticated;
