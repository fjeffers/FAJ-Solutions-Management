-- Migration 111: emergency contact and date of hire on every tech
--
-- Fred, 2026-10-06: "add to the profile of each tech an emergency number, date
-- of hire, time log for payment, something to keep track of them".
--
--   contractors.emergency_name / _phone / _relation   who to call if something
--       happens on a job. Fred sets it on the tech's form; the tech can fill
--       it in on their own Profile (tech_update_emergency).
--   contractors.hire_date   when they started with FAJ. Fred only.
--
-- tech_me also returns these so the tech sees what's on file. The tech's
-- emailed portal link already sends the tech their own contractor record, and
-- these are their own details, so that's fine. Assistants don't get them
-- (asst_techs names its columns).
-- The time & pay log on the tech's profile is built from data that already
-- exists (jobs, clock-ins, payments) — no table needed.

ALTER TABLE contractors ADD COLUMN IF NOT EXISTS emergency_name     text;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS emergency_phone    text;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS emergency_relation text;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS hire_date          date;

CREATE OR REPLACE FUNCTION public.tech_me()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ctx jsonb := tech_ctx(); v_out jsonb;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone,
    'business_name', c.business_name, 'entity_type', c.entity_type,
    'address', c.address, 'city', c.city, 'state', c.state, 'zip', c.zip,
    'payment_method', c.payment_method, 'default_hourly_rate', c.default_hourly_rate,
    'w9_received', c.w9_received, 'w9_submitted_at', c.w9_submitted_at,
    'contract_signed_at', c.contract_signed_at,
    'portal_last_login_at', c.portal_last_login_at, 'created_at', c.created_at,
    'emergency_name', c.emergency_name, 'emergency_phone', c.emergency_phone,
    'emergency_relation', c.emergency_relation, 'hire_date', c.hire_date
  ) INTO v_out FROM contractors c WHERE c.id = (v_ctx->>'contractor_id')::uuid;
  RETURN v_out;
END;
$function$;

-- The tech saves their own emergency contact. Blank clears it.
CREATE OR REPLACE FUNCTION public.tech_update_emergency(p_name text, p_phone text, p_relation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ctx jsonb := tech_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  UPDATE contractors
     SET emergency_name     = NULLIF(left(trim(coalesce(p_name, '')), 80), ''),
         emergency_phone    = NULLIF(left(trim(coalesce(p_phone, '')), 40), ''),
         emergency_relation = NULLIF(left(trim(coalesce(p_relation, '')), 40), ''),
         updated_at = NOW()
   WHERE id = (v_ctx->>'contractor_id')::uuid;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.tech_update_emergency(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tech_update_emergency(text, text, text) TO authenticated;
