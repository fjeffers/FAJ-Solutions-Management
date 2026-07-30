-- Migration 049: field-ops lifecycle — imports, site reports, pay from hours,
-- submit/approve, and portal onboarding documents.
--
-- Supports six connected pieces, in the order they happen on a real job:
--
--   import → work order + site visit (customer auto-matched)
--   tech works it, GPS-stamped, and SUBMITS
--   owner APPROVES or DENIES with a reason
--   logged hours become the suggested pay, instead of a hand-typed number
--   the customer's site activity becomes a shareable/downloadable report
--   and a tech can file their W-9 and sign their contract from the portal

-- ── 1. Shareable per-customer site activity report ──────────────────────────
-- Same pattern as invoices.share_token and user_settings.billing_share_token:
-- one token per customer → a read-only public page. Created on first share and
-- then reused, so links already sent keep working.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;

-- ── 2. Pay from logged hours ────────────────────────────────────────────────
-- contractors had no rate at all, so pay could only ever be typed by hand.
-- With a rate we can turn GPS-stamped hours into a suggested amount that the
-- owner accepts or overrides — the number is still the owner's decision.
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS default_hourly_rate NUMERIC;

-- Per-job override: this tech, this job, this rate.
ALTER TABLE contractor_time_logs ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC;
-- What the tech says they did, captured at checkout while it's fresh.
ALTER TABLE contractor_time_logs ADD COLUMN IF NOT EXISTS work_summary TEXT;
-- Manual correction when GPS times are wrong (forgot to check out, etc).
ALTER TABLE contractor_time_logs ADD COLUMN IF NOT EXISTS adjusted_hours NUMERIC;

-- ── 3. Submit → approve / deny ──────────────────────────────────────────────
-- work_orders already had submission_status, submitted_at, approved_at,
-- rejection_reason and reviewed_at. What was missing is who submitted it (a
-- multi-tech job needs to know) and somewhere to keep the denial history so a
-- second denial doesn't erase the first.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS submitted_by TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS review_history JSONB NOT NULL DEFAULT '[]';

-- ── 4. Portal onboarding documents ──────────────────────────────────────────
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS contract_url TEXT;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS contract_signed_at TIMESTAMPTZ;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS contract_signed_name TEXT;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS contract_signed_ip TEXT;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS w9_submitted_at TIMESTAMPTZ;

-- ── 5. Resolve a customer by any spelling, creating it if new ───────────────
-- Used by the import path so a job for 'Wendys' lands on the same customer as
-- "Wendy's". Registers the incoming spelling as an alias so the next import of
-- that spelling matches directly.
CREATE OR REPLACE FUNCTION public.customer_resolve_or_create(p_user_id uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clean text;
  v_key   text;
  v_id    uuid;
BEGIN
  v_clean := NULLIF(TRIM(COALESCE(p_name, '')), '');
  IF v_clean IS NULL THEN RETURN NULL; END IF;

  v_key := regexp_replace(lower(v_clean), '[^a-z0-9]', '', 'g');
  IF v_key = '' THEN RETURN NULL; END IF;

  -- Known spelling?
  SELECT customer_id INTO v_id FROM customer_aliases
   WHERE user_id = p_user_id AND alias IN (lower(v_clean), v_key) LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- Known canonical name?
  SELECT id INTO v_id FROM customers WHERE user_id = p_user_id AND lower(name) = lower(v_clean) LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO customers (user_id, name, status) VALUES (p_user_id, v_clean, 'active')
    ON CONFLICT (user_id, name) DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_id;
  END IF;

  -- Remember both this spelling and its squashed key.
  INSERT INTO customer_aliases (user_id, customer_id, alias)
  VALUES (p_user_id, v_id, lower(v_clean)), (p_user_id, v_id, v_key)
  ON CONFLICT (user_id, alias) DO NOTHING;

  RETURN v_id;
END;
$function$;

-- ── 6. Tech submits the job for review ─────────────────────────────────────
-- Goes through the same gate as every other portal write, and needs the
-- 'status' capability. Sets submission_status so it lands in the owner's
-- review queue rather than silently changing the job.
CREATE OR REPLACE FUNCTION public.portal_submit_work_order(p_token text, p_wo_id uuid, p_summary text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb;
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('error', 'Invalid token'); END IF;
  IF NOT portal_can(v_ctx, p_wo_id, 'status') THEN
    RETURN jsonb_build_object('error', 'Not allowed');
  END IF;

  UPDATE work_orders
     SET wo_status         = 'Work Done',
         submission_status = 'submitted',
         submitted_at      = NOW(),
         submitted_by      = v_ctx->>'display_name',
         closeout_notes    = COALESCE(NULLIF(TRIM(COALESCE(p_summary, '')), ''), closeout_notes),
         updated_at        = NOW()
   WHERE id = p_wo_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ── 7. Tech files their W-9 / signs their contract ─────────────────────────
-- Deliberately restricted to kind='contractor': a helper must never be able to
-- file a tax form or sign an agreement on someone else's behalf.
CREATE OR REPLACE FUNCTION public.portal_submit_document(
  p_token text, p_kind text, p_value text, p_signed_name text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb;
  v_cid uuid;
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
           w9_submitted_at = NOW(), w9_uploaded_by = 'contractor',
           w9_uploaded_at = NOW(), updated_at = NOW()
     WHERE id = v_cid;

  ELSIF p_kind = 'contract' THEN
    UPDATE contractors
       SET contract_signed_at = NOW(),
           contract_signed_name = COALESCE(p_signed_name, name),
           contract_url = COALESCE(p_value, contract_url),
           updated_at = NOW()
     WHERE id = v_cid;

  ELSE
    RETURN jsonb_build_object('error', 'Unknown document kind');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ── 8. Public read for the shared site report ──────────────────────────────
-- Token-gated, read-only, and money-free: dates, sites, hours and what was
-- done. No rates, no totals — this is a report you hand to a client.
CREATE OR REPLACE FUNCTION public.get_shared_site_report(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer jsonb;
  v_cid      uuid;
  v_uid      uuid;
  v_visits   jsonb;
BEGIN
  SELECT id, user_id,
         jsonb_build_object('name', name, 'city', city, 'state', state)
    INTO v_cid, v_uid, v_customer
  FROM customers WHERE share_token = p_token;

  IF v_cid IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'visit_date', v.visit_date,
           'site_name',  v.site_name,
           'site_code',  v.site_code,
           'address',    v.address,
           'time_in',    v.time_in,
           'time_out',   v.time_out,
           'hours',      v.hours,
           'visit_type', v.visit_type,
           'notes',      v.notes,
           'sessions',   v.sessions
         ) ORDER BY v.visit_date DESC NULLS LAST)
    INTO v_visits
  FROM site_visits v
  WHERE v.customer_id = v_cid AND v.user_id = v_uid;

  RETURN jsonb_build_object(
    'customer', v_customer,
    'visits',   COALESCE(v_visits, '[]'::jsonb)
  );
END;
$function$;
