-- Migration 154: customer_resolve_or_create only writes into the caller's own account.
--
-- Migration 049 trusted the p_user_id argument, and the function is SECURITY DEFINER, so
-- anyone holding the public anon key and the owner's id could add customers and aliases
-- to the owner's list. The owner is now always auth.uid(); a call naming anybody else,
-- or a call with no signed-in user, is refused. The signature is unchanged so the import
-- approve route (app/api/import-queue/[id]/approve/route.ts) keeps working as is.
-- Safe to run more than once.

CREATE OR REPLACE FUNCTION public.customer_resolve_or_create(p_user_id uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_clean text;
  v_key   text;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_uid THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  v_clean := NULLIF(TRIM(COALESCE(p_name, '')), '');
  IF v_clean IS NULL THEN RETURN NULL; END IF;

  v_key := regexp_replace(lower(v_clean), '[^a-z0-9]', '', 'g');
  IF v_key = '' THEN RETURN NULL; END IF;

  SELECT customer_id INTO v_id FROM customer_aliases
   WHERE user_id = v_uid AND alias IN (lower(v_clean), v_key) LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT id INTO v_id FROM customers WHERE user_id = v_uid AND lower(name) = lower(v_clean) LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO customers (user_id, name, status) VALUES (v_uid, v_clean, 'active')
    ON CONFLICT (user_id, name) DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO customer_aliases (user_id, customer_id, alias)
  VALUES (v_uid, v_id, lower(v_clean)), (v_uid, v_id, v_key)
  ON CONFLICT (user_id, alias) DO NOTHING;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_resolve_or_create(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_resolve_or_create(uuid, text) TO authenticated;
