-- Migration 054: how the tech wants to be paid, captured with their W-9.
--
-- The banking columns already existed but only the owner could fill them in, by
-- hand, from whatever the tech said over the phone. Nothing recorded which
-- method they actually preferred, so 'do I Zelle this one or ACH it' was
-- guesswork per payout.
--
-- The tech now answers it themselves alongside their W-9 — the one moment they
-- are already entering their details.
--
-- These are bank credentials, so: they go in through the same SECURITY DEFINER
-- gate as the rest of the W-9, and get_portal_data has stripped routing_number,
-- account_number, account_type, bank_name and account_holder_name since
-- migration 047. A tech can write their own and can never read anyone's back,
-- including their own.

ALTER TABLE contractors ADD COLUMN IF NOT EXISTS payment_method TEXT
  CHECK (payment_method IN ('Zelle', 'Direct Deposit', 'Check', 'Other'));

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

  -- Digits only, same reasoning as the TIN: one stored shape, no guessing later.
  v_routing := NULLIF(regexp_replace(COALESCE(p_routing_number, ''), '[^0-9]', '', 'g'), '');
  v_account := NULLIF(regexp_replace(COALESCE(p_account_number, ''), '[^0-9]', '', 'g'), '');

  -- A half-entered bank account silently failing a payout is worse than a
  -- refusal here, so Direct Deposit demands the parts that actually move money.
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
         w9_uploaded_by  = 'contractor',
         w9_uploaded_at  = NOW(),
         updated_at      = NOW()
   WHERE id = v_cid
   RETURNING name INTO v_name;

  RETURN jsonb_build_object('ok', true, 'contractor_name', v_name);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.portal_submit_w9_details(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text
) TO anon, authenticated;
