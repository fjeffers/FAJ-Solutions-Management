-- Migration 055: W-9 filing was rejected by the database on every attempt.
--
-- contractors.w9_uploaded_by carries CHECK (w9_uploaded_by IN ('self','owner')),
-- but portal_submit_document has written 'contractor' since migration 049, and
-- portal_submit_w9_details inherited the same wrong value. Postgres refused the
-- UPDATE every time:
--
--   new row for relation "contractors" violates check constraint
--   "contractors_w9_uploaded_by_check"
--
-- So a tech could fill the form in, press submit, and have nothing saved. Nine
-- of these are in the last day of logs alone.
--
-- 'self' is the existing word for exactly this — the contractor filed it
-- themselves, as opposed to 'owner' meaning Fred entered it for them. Writing
-- the correct value is better than widening the constraint to accept a second
-- word for the same thing.

CREATE OR REPLACE FUNCTION public.portal_submit_document(
  p_token text, p_kind text, p_value text, p_signed_name text DEFAULT NULL
)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb; v_cid uuid; v_name text;
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('error', 'Invalid token'); END IF;

  IF v_ctx->>'kind' <> 'contractor' THEN
    RETURN jsonb_build_object('error', 'Only the contractor can file their own documents');
  END IF;

  v_cid := (v_ctx->>'contractor_id')::uuid;

  IF p_kind = 'w9' THEN
    UPDATE contractors
       SET w9_file_path = p_value, w9_received = TRUE,
           w9_submitted_at = NOW(), w9_uploaded_by = 'self',
           w9_uploaded_at = NOW(), updated_at = NOW()
     WHERE id = v_cid
     RETURNING name INTO v_name;

  ELSIF p_kind = 'contract' THEN
    UPDATE contractors
       SET contract_signed_at = NOW(),
           contract_signed_name = COALESCE(p_signed_name, name),
           contract_url = COALESCE(p_value, contract_url),
           updated_at = NOW()
     WHERE id = v_cid
     RETURNING name INTO v_name;

  ELSE
    RETURN jsonb_build_object('error', 'Unknown document kind');
  END IF;

  RETURN jsonb_build_object('ok', true, 'contractor_name', v_name);
END;
$function$;

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
  p_signed_name text,
  p_payment_method text DEFAULT NULL,
  p_zelle_phone    text DEFAULT NULL,
  p_bank_name      text DEFAULT NULL,
  p_account_holder text DEFAULT NULL,
  p_routing_number text DEFAULT NULL,
  p_account_number text DEFAULT NULL,
  p_account_type   text DEFAULT NULL
)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb; v_cid uuid; v_tax text; v_name text;
  v_routing text; v_account text; v_method text;
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('error', 'Invalid token'); END IF;
  IF v_ctx->>'kind' <> 'contractor' THEN
    RETURN jsonb_build_object('error', 'Only the contractor can file their own W-9');
  END IF;

  v_cid := (v_ctx->>'contractor_id')::uuid;
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

  v_method := NULLIF(TRIM(COALESCE(p_payment_method, '')), '');
  IF v_method IS NOT NULL AND v_method NOT IN ('Zelle','Direct Deposit','Check','Other') THEN
    RETURN jsonb_build_object('error', 'Choose a payment method from the list');
  END IF;

  v_routing := NULLIF(regexp_replace(COALESCE(p_routing_number, ''), '[^0-9]', '', 'g'), '');
  v_account := NULLIF(regexp_replace(COALESCE(p_account_number, ''), '[^0-9]', '', 'g'), '');

  IF v_method = 'Direct Deposit' THEN
    IF v_routing IS NULL OR length(v_routing) <> 9 THEN
      RETURN jsonb_build_object('error', 'A routing number is 9 digits');
    END IF;
    IF v_account IS NULL OR length(v_account) < 4 THEN
      RETURN jsonb_build_object('error', 'Enter your account number');
    END IF;
  END IF;

  IF v_method = 'Zelle' AND COALESCE(TRIM(p_zelle_phone), '') = '' THEN
    RETURN jsonb_build_object('error', 'Enter the phone or email for your Zelle');
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
         payment_method  = COALESCE(v_method, payment_method),
         zelle_phone     = COALESCE(NULLIF(TRIM(COALESCE(p_zelle_phone, '')), ''), zelle_phone),
         bank_name       = COALESCE(NULLIF(TRIM(COALESCE(p_bank_name, '')), ''), bank_name),
         account_holder_name = COALESCE(NULLIF(TRIM(COALESCE(p_account_holder, '')), ''), account_holder_name),
         routing_number  = COALESCE(v_routing, routing_number),
         account_number  = COALESCE(v_account, account_number),
         account_type    = COALESCE(NULLIF(TRIM(COALESCE(p_account_type, '')), ''), account_type),
         w9_received     = TRUE,
         w9_submitted_at = NOW(),
         w9_uploaded_by  = 'self',
         w9_uploaded_at  = NOW(),
         updated_at      = NOW()
   WHERE id = v_cid
   RETURNING name INTO v_name;

  RETURN jsonb_build_object('ok', true, 'contractor_name', v_name);
END;
$function$;
