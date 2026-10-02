-- Migration 095: the accountant role — audit, taxes, 1099s and W-9s.
--
-- Fred: "the accountant is for audit and taxes and 1099 W9 forms."
--
-- An accountant sees money, read-only: what techs were paid (by year, with the
-- 1099 picture), what clients were invoiced and paid, and each job's revenue,
-- payout and profit. They see a tech's legal name, business, entity type and
-- mailing address, which 1099s need. A tax ID shows as its last four digits
-- until they press Show, and every Show is written to Fred's activity log.
-- They never see bank, routing or account numbers, Zelle details, the portal
-- tokens, or anything Fred did not put on the books.
--
-- Same wall as the assistant: role 'accountant' answers only to acct_ctx(),
-- and every acct_* function names its columns (jobs excepted, see acct_jobs).
--
-- Also fixed here: the contractor-docs storage bucket (W-9 files, which carry
-- SSNs) let ANY signed-in user read every file, because its read policy only
-- checked the bucket name. No W-9 file had been uploaded yet, so nothing was
-- exposed. Now only the owner of the tech whose W-9 it is can read it, and
-- the accountant opens one through /api/accountant/w9, which re-checks the role
-- and logs it. That route keeps the file path, which embeds the tech's portal
-- token, on the server.

-- ─── The role ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.staff_role_allowed(p_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT p_role IN ('assistant', 'accountant'); $$;

CREATE OR REPLACE FUNCTION public.acct_ctx()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v jsonb := staff_ctx();
BEGIN
  IF v IS NULL OR v ->> 'role' <> 'accountant' THEN RETURN NULL; END IF;
  RETURN v;
END;
$$;

-- Which section a signed-in staff member belongs in (the owner app's root asks).
CREATE OR REPLACE FUNCTION public.my_staff_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$ SELECT staff_ctx() ->> 'role'; $$;

CREATE OR REPLACE FUNCTION public.acct_me()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$ SELECT acct_ctx(); $$;

-- ─── 1099s: one row per tech paid in the year ───────────────────────────────

CREATE OR REPLACE FUNCTION public.acct_1099(p_year int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := acct_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(t.r ORDER BY (t.r ->> 'paid')::numeric DESC) FROM (
      SELECT jsonb_build_object(
        'name', p.contractor_name,
        'contractor_id', c.id,
        'business_name', c.business_name,
        'entity_type', c.entity_type,
        'tax_id_type', c.tax_id_type,
        'tax_id_last4', CASE WHEN COALESCE(c.tax_id, '') = '' THEN NULL
                             ELSE right(regexp_replace(c.tax_id, '\D', '', 'g'), 4) END,
        'address', c.address, 'city', c.city, 'state', c.state, 'zip', c.zip,
        'email', c.email,
        'w9_received', COALESCE(c.w9_received, false),
        'w9_file', c.w9_file_path IS NOT NULL,
        'w9_submitted_at', c.w9_submitted_at,
        'paid', round(sum(p.amount), 2),
        'payments', count(*)
      ) AS r
      FROM payments p
      LEFT JOIN contractors c
        ON c.user_id = p.user_id AND c.name = p.contractor_name
      WHERE p.user_id = (v_ctx ->> 'owner_id')::uuid
        AND extract(year FROM p.payment_date) = p_year
      GROUP BY p.contractor_name, c.id
    ) t
  ), '[]'::jsonb);
END;
$$;

-- The full tax ID, on purpose, one tech at a time — and Fred sees that it happened.
CREATE OR REPLACE FUNCTION public.acct_reveal_tin(p_contractor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := acct_ctx();
  v_c   record;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_an_accountant'); END IF;
  SELECT id, name, tax_id, tax_id_type INTO v_c
  FROM contractors WHERE id = p_contractor AND user_id = (v_ctx ->> 'owner_id')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF COALESCE(v_c.tax_id, '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_tax_id'); END IF;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES ((v_ctx ->> 'owner_id')::uuid, 'view', 'tax_id', v_c.id::text,
          jsonb_build_object('label', (v_ctx ->> 'name') || ' viewed the tax ID for ' || v_c.name,
                             'by_assistant', v_ctx ->> 'name', 'role', 'accountant'));
  RETURN jsonb_build_object('ok', true, 'reason', 'shown', 'tax_id', v_c.tax_id, 'tax_id_type', v_c.tax_id_type);
END;
$$;

-- ─── Money in and out ───────────────────────────────────────────────────────

-- Every payout to a tech in the year.
CREATE OR REPLACE FUNCTION public.acct_payments(p_year int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := acct_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'payment_date', p.payment_date, 'contractor_name', p.contractor_name,
      'wo_number', p.wo_number, 'amount', p.amount, 'method', p.method, 'notes', p.notes,
      'in_quickbooks', p.qbo_synced_at IS NOT NULL
    ) ORDER BY p.payment_date, p.contractor_name)
    FROM payments p
    WHERE p.user_id = (v_ctx ->> 'owner_id')::uuid
      AND extract(year FROM p.payment_date) = p_year
  ), '[]'::jsonb);
END;
$$;

-- Client invoices issued in the year, with what has been paid on each.
CREATE OR REPLACE FUNCTION public.acct_invoices(p_year int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := acct_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'invoice_number', i.invoice_number, 'client_name', i.client_name, 'title', i.title,
      'issued', COALESCE(i.sent_at, i.created_at)::date, 'due_date', i.due_date,
      'subtotal', i.subtotal, 'tax_amount', i.tax_amount, 'total', i.total, 'status', i.status,
      'paid', COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0),
      'paid_at', i.paid_at
    ) ORDER BY COALESCE(i.sent_at, i.created_at), i.invoice_number)
    FROM invoices i
    WHERE i.user_id = (v_ctx ->> 'owner_id')::uuid
      AND extract(year FROM COALESCE(i.sent_at, i.created_at)) = p_year
  ), '[]'::jsonb);
END;
$$;

-- Money received from clients in the year (cash basis).
CREATE OR REPLACE FUNCTION public.acct_received(p_year int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := acct_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', ip.id, 'payment_date', ip.payment_date, 'amount', ip.amount, 'method', ip.method,
      'reference', ip.reference, 'invoice_number', i.invoice_number, 'client_name', i.client_name
    ) ORDER BY ip.payment_date)
    FROM invoice_payments ip
    JOIN invoices i ON i.id = ip.invoice_id
    WHERE ip.user_id = (v_ctx ->> 'owner_id')::uuid
      AND extract(year FROM ip.payment_date) = p_year
  ), '[]'::jsonb);
END;
$$;

-- Jobs dated in the year, as whole rows so the app's own money math
-- (lib/utils woPayoutTotal / woProfitOrNull) runs on them unchanged, rather
-- than a second copy of that math in SQL. An accountant is meant to see job
-- money. What is removed is what is not money: the client portal token and
-- email-tracking ids.
CREATE OR REPLACE FUNCTION public.acct_jobs(p_year int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := acct_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
      to_jsonb(w) - ARRAY['public_token', 'resend_email_id', 'sent_to_email', 'review_history', 'custom_qa']
      ORDER BY COALESCE(w.scheduled_date, w.start_date, w.created_at::date), w.wo_number)
    FROM work_orders w
    WHERE w.user_id = (v_ctx ->> 'owner_id')::uuid
      AND w.archived_at IS NULL
      AND extract(year FROM COALESCE(w.scheduled_date, w.start_date, w.created_at::date)) = p_year
  ), '[]'::jsonb);
END;
$$;

-- ─── W-9 files: owner-only reads (the leak fix) ─────────────────────────────

DROP POLICY IF EXISTS "owner reads contractor docs" ON storage.objects;
CREATE POLICY "owner reads contractor docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'contractor-docs'
         AND EXISTS (SELECT 1 FROM public.contractors c
                      WHERE c.w9_file_path = storage.objects.name
                        AND c.user_id = auth.uid()));

-- ─── Grants ─────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.acct_ctx() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.my_staff_role(), public.acct_me(), public.acct_1099(int), public.acct_reveal_tin(uuid),
  public.acct_payments(int), public.acct_invoices(int), public.acct_received(int), public.acct_jobs(int)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.my_staff_role(), public.acct_me(), public.acct_1099(int), public.acct_reveal_tin(uuid),
  public.acct_payments(int), public.acct_invoices(int), public.acct_received(int), public.acct_jobs(int)
TO authenticated;
