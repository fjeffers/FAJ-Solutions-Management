-- Migration 052: the tech types their own W-9 details.
--
-- Until now the portal only took an UPLOAD of a signed W-9. That is fine as a
-- record, but nothing in it is readable by the app, so the fields QuickBooks
-- needs for a 1099 vendor — legal name, TIN, address — still had to be typed by
-- the owner off the PDF. For a brand-new contractor the owner does not have
-- those details at all.
--
-- This lets the tech fill them in themselves. Same gate as every other portal
-- write: the RPC resolves the token and refuses anything that is not
-- kind='contractor', so a helper link can never file a tax form for someone else.
--
-- The upload path is unchanged and still recommended alongside this — the signed
-- form is the legal record, these fields are what the software can act on.

CREATE OR REPLACE FUNCTION public.portal_submit_w9_details(
  p_token       text,
  p_legal_name  text,
  p_business_name text,
  p_entity_type text,
  p_tax_id_type text,
  p_tax_id      text,
  p_address     text,
  p_city        text,
  p_state       text,
  p_zip         text,
  p_phone       text,
  p_email       text,
  p_signed_name text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb;
  v_cid uuid;
  v_tax text;
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('error', 'Invalid token'); END IF;

  IF v_ctx->>'kind' <> 'contractor' THEN
    RETURN jsonb_build_object('error', 'Only the contractor can file their own W-9');
  END IF;

  v_cid := (v_ctx->>'contractor_id')::uuid;

  -- Digits only, so '123-45-6789' and '123456789' store the same way and the
  -- QuickBooks vendor sync does not have to guess at the format.
  v_tax := regexp_replace(COALESCE(p_tax_id, ''), '[^0-9]', '', 'g');

  IF length(v_tax) <> 9 THEN
    RETURN jsonb_build_object('error', 'A TIN is 9 digits — check the SSN or EIN');
  END IF;

  IF COALESCE(TRIM(p_legal_name), '') = '' THEN
    RETURN jsonb_build_object('error', 'Legal name is required');
  END IF;

  IF COALESCE(TRIM(p_signed_name), '') = '' THEN
    RETURN jsonb_build_object('error', 'Type your full name to certify');
  END IF;

  IF p_tax_id_type NOT IN ('SSN', 'EIN') THEN
    RETURN jsonb_build_object('error', 'Choose SSN or EIN');
  END IF;

  UPDATE contractors
     SET name            = TRIM(p_legal_name),
         business_name   = NULLIF(TRIM(COALESCE(p_business_name, '')), ''),
         entity_type     = NULLIF(TRIM(COALESCE(p_entity_type, '')), ''),
         tax_id_type     = p_tax_id_type,
         tax_id          = v_tax,
         address         = NULLIF(TRIM(COALESCE(p_address, '')), ''),
         city            = NULLIF(TRIM(COALESCE(p_city, '')), ''),
         state           = NULLIF(TRIM(COALESCE(p_state, '')), ''),
         zip             = NULLIF(TRIM(COALESCE(p_zip, '')), ''),
         phone           = COALESCE(NULLIF(TRIM(COALESCE(p_phone, '')), ''), phone),
         email           = COALESCE(NULLIF(TRIM(COALESCE(p_email, '')), ''), email),
         w9_received     = TRUE,
         w9_submitted_at = NOW(),
         w9_uploaded_by  = 'contractor',
         w9_uploaded_at  = NOW(),
         updated_at      = NOW()
   WHERE id = v_cid;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Anonymous callers reach this the same way they reach the other portal RPCs:
-- through the token, which the function itself validates.
GRANT EXECUTE ON FUNCTION public.portal_submit_w9_details(
  text, text, text, text, text, text, text, text, text, text, text, text, text
) TO anon, authenticated;
