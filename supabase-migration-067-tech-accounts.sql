-- Migration 067: tech accounts — a real login, not just a forwarded link
--
-- ─── What was wrong ─────────────────────────────────────────────────────────
--
-- A tech's only way in was contractors.portal_token: one permanent UUID in a
-- URL, emailed to them. Anyone holding that link IS that tech — forward the
-- email and you have handed over their access. There was also nowhere for a
-- tech to see their own history: get_portal_data deliberately hides Approved
-- and Paid work orders, so the moment a job closed it vanished, and payments
-- were never exposed at all. A tech had no way to answer "what did I work on
-- last month and what was I paid for it" except to ask Fred.
--
-- ─── The model ──────────────────────────────────────────────────────────────
--
-- Techs get a Supabase Auth login of their own. auth.uid() — not a URL token —
-- is the identity. contractors.auth_user_id binds that login to exactly one
-- contractor row, and every read goes through a SECURITY DEFINER function that
-- resolves the caller from auth.uid() and filters to that contractor. There is
-- no direct table access: RLS on contractors/work_orders/payments is still
-- `auth.uid() = user_id` (Fred's id), so a logged-in tech selecting those
-- tables directly gets zero rows. That is the safety net; these functions are
-- the only door.
--
-- ─── What a tech can see ────────────────────────────────────────────────────
--
--   Profile        their own contact details. Never bank, routing, account,
--                  tax ID, W-9 path, or Fred's private notes.
--   Jobs           every job assigned to them, open AND closed. NO money on a
--                  job, ever — not the client price, not their own pay, and
--                  above all not another tech's pay.
--   Payments       what they were actually paid: date, amount, method, and
--                  which work order it was for. Their rows only.
--
-- Money lives in payment history; the work order stays clean. That split is
-- deliberate — a tech looking at a job sees the work, and a tech looking at
-- their earnings sees the money, and the two never mix on one screen.
--
-- The old token portal (migrations 047/048) is untouched and still works.

-- ─── Binding a login to a tech ──────────────────────────────────────────────

ALTER TABLE contractors ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS portal_last_login_at TIMESTAMPTZ;

-- One login is one tech. Without this a single auth user could claim several
-- contractor rows and read all of their pay.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contractors_auth_user ON contractors (auth_user_id) WHERE auth_user_id IS NOT NULL;

-- ─── Who is calling? ────────────────────────────────────────────────────────
-- Every function below starts here. Returns NULL for anyone who is not a
-- linked, enabled tech — including Fred, who uses the main app instead.
CREATE OR REPLACE FUNCTION public.tech_ctx()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
           'contractor_id',   c.id,
           'contractor_name', c.name,
           'owner_id',        c.user_id
         )
    INTO v_out
  FROM contractors c
  WHERE c.auth_user_id = auth.uid()
    AND c.portal_enabled;

  RETURN v_out;
END;
$function$;

-- ─── First login: claim the contractor row that matches your email ──────────
-- Fred creates the contractor with an email; the tech signs up with that same
-- address and this binds the two. Guards:
--   * the email must be CONFIRMED — otherwise anyone could sign up as
--     someone else's address and claim their earnings before verifying
--   * the contractor row must not already be claimed
--   * the auth user must not already hold a different contractor row
CREATE OR REPLACE FUNCTION public.tech_claim_account()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email     text;
  v_confirmed timestamptz;
  v_id        uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in'); END IF;

  -- Already linked? Nothing to do.
  IF EXISTS (SELECT 1 FROM contractors WHERE auth_user_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_linked');
  END IF;

  SELECT u.email, u.email_confirmed_at INTO v_email, v_confirmed
  FROM auth.users u WHERE u.id = auth.uid();

  IF v_confirmed IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'email_not_confirmed');
  END IF;

  -- Case-insensitive match on an unclaimed, enabled contractor.
  SELECT c.id INTO v_id
  FROM contractors c
  WHERE lower(c.email) = lower(v_email)
    AND c.auth_user_id IS NULL
    AND c.portal_enabled
  ORDER BY c.created_at
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_matching_contractor');
  END IF;

  UPDATE contractors
     SET auth_user_id = auth.uid(),
         portal_last_login_at = NOW(),
         updated_at = NOW()
   WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'reason', 'linked');
END;
$function$;

-- ─── Profile ────────────────────────────────────────────────────────────────
-- Explicit column list, never to_jsonb(c). A new sensitive column added later
-- cannot leak through a function that names every field it returns.
CREATE OR REPLACE FUNCTION public.tech_me()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_out jsonb;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
           'id',                   c.id,
           'name',                 c.name,
           'email',                c.email,
           'phone',                c.phone,
           'business_name',        c.business_name,
           'entity_type',          c.entity_type,
           'address',              c.address,
           'city',                 c.city,
           'state',                c.state,
           'zip',                  c.zip,
           'payment_method',       c.payment_method,
           'default_hourly_rate',  c.default_hourly_rate,
           -- Compliance status: whether it's on file, never the document itself
           'w9_received',          c.w9_received,
           'w9_submitted_at',      c.w9_submitted_at,
           'contract_signed_at',   c.contract_signed_at,
           'portal_last_login_at', c.portal_last_login_at,
           'created_at',           c.created_at
         )
    INTO v_out
  FROM contractors c
  WHERE c.id = (v_ctx->>'contractor_id')::uuid;

  RETURN v_out;
END;
$function$;

-- A tech maintaining their own contact details. Deliberately narrow: they may
-- fix a phone number or address, nothing that touches money or compliance.
CREATE OR REPLACE FUNCTION public.tech_update_profile(
  p_phone text, p_address text, p_city text, p_state text, p_zip text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;

  UPDATE contractors
     SET phone      = COALESCE(NULLIF(trim(p_phone), ''),   phone),
         address    = COALESCE(NULLIF(trim(p_address), ''), address),
         city       = COALESCE(NULLIF(trim(p_city), ''),    city),
         state      = COALESCE(NULLIF(trim(p_state), ''),   state),
         zip        = COALESCE(NULLIF(trim(p_zip), ''),     zip),
         updated_at = NOW()
   WHERE id = (v_ctx->>'contractor_id')::uuid;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ─── Jobs: everything they worked on, open and closed, with no money ────────
-- Named columns only. total_amount, contractor_pay, hourly_rate, expense_budget
-- and materials_used are not in this list and never will be — a tech reading a
-- job must not learn what FAJ charged the client, and must never see another
-- tech's wages.
CREATE OR REPLACE FUNCTION public.tech_my_jobs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx  jsonb := tech_ctx();
  v_name text;
  v_out  jsonb;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;
  v_name := v_ctx->>'contractor_name';

  SELECT jsonb_agg(j ORDER BY sort_date DESC NULLS LAST)
    INTO v_out
  FROM (
    SELECT jsonb_build_object(
             'id',              w.id,
             'wo_number',       w.wo_number,
             'title',           w.title,
             'description',     w.description,
             'scope_of_work',   w.scope_of_work,
             'service_type',    w.service_type,
             'wo_status',       w.wo_status,
             'customer_name',   w.customer_name,
             'project_name',    w.project_name,
             'site_name',       w.site_name,
             'site_address',    w.site_address,
             'site_city',       w.site_city,
             'site_state',      w.site_state,
             'site_zip',        w.site_zip,
             'start_date',      w.start_date,
             'end_date',        w.end_date,
             'scheduled_date',  w.scheduled_date,
             'checked_in_at',   COALESCE(ctl.checked_in_at,  w.checked_in_at),
             'checked_out_at',  COALESCE(ctl.checked_out_at, w.checked_out_at),
             -- This tech's own logged hours, falling back to the job's.
             -- contractor_time_logs.hourly_rate is money and is deliberately
             -- NOT selected here.
             'hours_worked',    COALESCE(ctl.adjusted_hours, w.hours_worked),
             'closeout_notes',  w.closeout_notes,
             'archived_at',     w.archived_at,
             'is_closed',       (w.wo_status IN ('Approved','Paid') OR w.archived_at IS NOT NULL),
             'created_at',      w.created_at
           ) AS j,
           COALESCE(w.scheduled_date, w.start_date, w.created_at::date) AS sort_date
      FROM work_orders w
      LEFT JOIN contractor_time_logs ctl
        ON ctl.wo_id = w.id AND ctl.contractor_name = v_name
     WHERE w.user_id = (v_ctx->>'owner_id')::uuid
       AND (
             w.contractor_name = v_name
             OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
             OR w.lead_contractor_name = v_name
           )
  ) sub;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

-- ─── Payments: what they were actually paid ─────────────────────────────────
-- payments rows are payouts to techs, so the whole table is money owed to
-- somebody. Filtered to this tech's own name and their owner — a tech never
-- sees a cent of anyone else's.
CREATE OR REPLACE FUNCTION public.tech_my_payments()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_out jsonb;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'id',            p.id,
             'payment_date',  p.payment_date,
             'amount',        p.amount,
             'method',        p.method,
             'notes',         p.notes,
             'wo_number',     p.wo_number,
             -- Job context so a payment reads as "for the Wendy's job", not a
             -- bare number. Still no job money — just which job it was.
             'wo_title',      w.title,
             'wo_site',       COALESCE(w.site_name, w.customer_name),
             'wo_id',         w.id
           )
           ORDER BY p.payment_date DESC, p.created_at DESC
         )
    INTO v_out
  FROM payments p
  LEFT JOIN work_orders w
    ON w.wo_number = p.wo_number AND w.user_id = p.user_id
  WHERE p.contractor_name = (v_ctx->>'contractor_name')
    AND p.user_id = (v_ctx->>'owner_id')::uuid;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

-- ─── Earnings summary — the numbers a tech wants at a glance ────────────────
CREATE OR REPLACE FUNCTION public.tech_my_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_out jsonb;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
           'paid_all_time',    COALESCE(SUM(p.amount), 0),
           'paid_this_year',   COALESCE(SUM(p.amount) FILTER (
                                 WHERE date_part('year', p.payment_date) = date_part('year', CURRENT_DATE)
                               ), 0),
           'payment_count',    COUNT(*),
           'last_payment_at',  MAX(p.payment_date)
         )
    INTO v_out
  FROM payments p
  WHERE p.contractor_name = (v_ctx->>'contractor_name')
    AND p.user_id = (v_ctx->>'owner_id')::uuid;

  RETURN v_out || jsonb_build_object(
    'jobs_total',  (SELECT COUNT(*) FROM work_orders w
                     WHERE w.user_id = (v_ctx->>'owner_id')::uuid
                       AND (w.contractor_name = (v_ctx->>'contractor_name')
                            OR (v_ctx->>'contractor_name') = ANY(COALESCE(w.contractor_names, ARRAY[]::text[])))),
    'jobs_open',   (SELECT COUNT(*) FROM work_orders w
                     WHERE w.user_id = (v_ctx->>'owner_id')::uuid
                       AND (w.contractor_name = (v_ctx->>'contractor_name')
                            OR (v_ctx->>'contractor_name') = ANY(COALESCE(w.contractor_names, ARRAY[]::text[])))
                       AND w.wo_status NOT IN ('Approved','Paid')
                       AND w.archived_at IS NULL)
  );
END;
$function$;

-- ─── Grants ─────────────────────────────────────────────────────────────────
-- authenticated only. anon must not reach these: without a session tech_ctx()
-- returns NULL and every function returns NULL anyway, but there is no reason
-- to expose the surface at all.
-- tech_ctx is an internal helper: the other functions call it as the definer,
-- so nothing outside the database needs to reach it.
REVOKE ALL ON FUNCTION public.tech_ctx()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tech_claim_account()  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_me()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_update_profile(text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_my_jobs()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_my_payments()    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_my_summary()     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.tech_claim_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_me()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_update_profile(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_my_jobs()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_my_payments()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_my_summary()    TO authenticated;
