-- Migration 103: expenses on any job (receipts from the tech portal)
--
-- Fred, 2026-10-02: "build the expenses next" (the idea from SimplySub). A
-- tech snaps a receipt on their job; Fred approves or declines it; an approved
-- expense is paid back to that tech through the existing money rules.
--
--   job_expenses            one receipt: job, tech, category, store, amount,
--                           date, note, receipt photo, and Fred's decision.
--                           Owner reads through RLS; only the functions write.
--   job-receipts bucket     private. Receipt photos live at <wo_id>/<file>.jpg;
--                           the owner of the job may read them.
--   wf_tech_add_expense()   a tech records a receipt on their own live job.
--   wf_tech_job_expenses()  a tech's own receipts on a job, with the decision.
--   wf_owner_decide_expense() Fred approves or declines. Approving adds ONE
--                           pay add-on line to the job (pay_tech, not billed to
--                           the client, belonging to that tech), so Pay Techs,
--                           what the tech is owed and the job's profit all pick
--                           it up through lib/utils as they already do.
--                           Declining (or un-approving) removes that line.
--
-- The money trap this avoids: billableExtras() reads the old billable_travel /
-- billable_materials / billable_other columns ONLY while a job has no add-on
-- lines. On a job with those (22 today) the first add-on would silently drop
-- that client billing. So the first time an expense is approved on such a
-- job, those three are carried over as add-on lines billed to the client and
-- not paid to the tech — every existing figure stays exactly as it was.

CREATE TABLE IF NOT EXISTS public.job_expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  wo_id           uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  wo_number       text NOT NULL,
  contractor_name text NOT NULL,
  category        text NOT NULL CHECK (category IN ('materials', 'fuel', 'tolls_parking', 'equipment', 'meals', 'other')),
  vendor          text,
  amount          numeric(10, 2) NOT NULL CHECK (amount > 0 AND amount < 10000),
  expense_date    date NOT NULL,
  note            text,
  receipt_path    text,
  status          text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'declined')),
  decided_at      timestamptz,
  decline_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_expenses_wo_idx ON public.job_expenses (wo_id, created_at);
CREATE INDEX IF NOT EXISTS job_expenses_open_idx ON public.job_expenses (user_id, status);
ALTER TABLE public.job_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_expenses_owner_read ON public.job_expenses;
CREATE POLICY job_expenses_owner_read ON public.job_expenses FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.job_expenses FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.job_expenses FROM authenticated;

INSERT INTO storage.buckets (id, name, public) VALUES ('job-receipts', 'job-receipts', false)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS job_receipts_owner_read ON storage.objects;
CREATE POLICY job_receipts_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'job-receipts' AND EXISTS (
    SELECT 1 FROM public.work_orders w WHERE w.id::text = (storage.foldername(name))[1] AND w.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.wf_tech_add_expense(
  p_wo_number text, p_category text, p_vendor text, p_amount numeric, p_date date, p_note text, p_receipt_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_target jsonb := wf_tech_photo_target(p_wo_number);
  v_wo uuid;
  v_id uuid;
BEGIN
  IF v_target IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;
  v_wo := (v_target ->> 'wo_id')::uuid;
  IF p_category NOT IN ('materials', 'fuel', 'tolls_parking', 'equipment', 'meals', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_category');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount >= 10000 THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount'); END IF;
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE 'America/New_York')::date + 1 OR p_date < (now() - interval '120 days')::date THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_date');
  END IF;
  IF p_receipt_path IS NOT NULL AND p_receipt_path !~ ('^' || v_wo::text || '/[0-9a-z_-]+\.jpg$') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_file');
  END IF;

  INSERT INTO job_expenses (user_id, wo_id, wo_number, contractor_name, category, vendor, amount, expense_date, note, receipt_path)
  VALUES ((v_ctx ->> 'owner_id')::uuid, v_wo, p_wo_number, v_ctx ->> 'contractor_name', p_category,
          NULLIF(left(btrim(COALESCE(p_vendor, '')), 120), ''), round(p_amount, 2), p_date,
          NULLIF(left(btrim(COALESCE(p_note, '')), 1000), ''), p_receipt_path)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_tech_job_expenses(p_wo_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', e.id, 'category', e.category, 'vendor', e.vendor, 'amount', e.amount, 'expense_date', e.expense_date,
             'note', e.note, 'has_receipt', e.receipt_path IS NOT NULL, 'status', e.status, 'decline_reason', e.decline_reason)
           ORDER BY e.created_at DESC)
      FROM job_expenses e
     WHERE e.wo_number = p_wo_number AND e.user_id = (v_ctx ->> 'owner_id')::uuid
       AND e.contractor_name = v_ctx ->> 'contractor_name'
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_owner_decide_expense(p_id uuid, p_approve boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_e job_expenses%ROWTYPE;
  v_wo work_orders%ROWTYPE;
  v_addons jsonb;
  v_line_id text;
  v_kind text;
  v_label text;
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  SELECT * INTO v_e FROM job_expenses WHERE id = p_id AND user_id = auth.uid() FOR UPDATE;
  IF v_e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO v_wo FROM work_orders WHERE id = v_e.wo_id AND user_id = auth.uid() FOR UPDATE;
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  v_line_id := 'exp_' || v_e.id::text;
  -- Drop this expense's line first, so deciding again never doubles it.
  v_addons := COALESCE((SELECT jsonb_agg(a) FROM jsonb_array_elements(COALESCE(v_wo.pay_addons, '[]'::jsonb)) a
                         WHERE a ->> 'id' IS DISTINCT FROM v_line_id), '[]'::jsonb);

  IF p_approve THEN
    -- Carry the old client billing over before the first add-on (see header).
    IF jsonb_array_length(v_addons) = 0 THEN
      IF COALESCE(v_wo.billable_travel, 0) > 0 THEN
        v_addons := v_addons || jsonb_build_object('id', 'legacy_travel', 'kind', 'mileage', 'label', 'Travel (billed to client)',
          'amount', v_wo.billable_travel, 'qty', NULL, 'rate', NULL, 'deduct', false, 'bill_client', true, 'pay_tech', false, 'contractor_name', NULL);
      END IF;
      IF COALESCE(v_wo.billable_materials, 0) > 0 THEN
        v_addons := v_addons || jsonb_build_object('id', 'legacy_materials', 'kind', 'materials', 'label', 'Materials (billed to client)',
          'amount', v_wo.billable_materials, 'qty', NULL, 'rate', NULL, 'deduct', false, 'bill_client', true, 'pay_tech', false, 'contractor_name', NULL);
      END IF;
      IF COALESCE(v_wo.billable_other, 0) > 0 THEN
        v_addons := v_addons || jsonb_build_object('id', 'legacy_other', 'kind', 'other', 'label', 'Other (billed to client)',
          'amount', v_wo.billable_other, 'qty', NULL, 'rate', NULL, 'deduct', false, 'bill_client', true, 'pay_tech', false, 'contractor_name', NULL);
      END IF;
    END IF;
    v_kind := CASE v_e.category WHEN 'materials' THEN 'materials' WHEN 'tolls_parking' THEN 'tolls_parking'
                                WHEN 'equipment' THEN 'equipment' WHEN 'meals' THEN 'per_diem' ELSE 'other' END;
    v_label := CASE v_e.category WHEN 'materials' THEN 'Parts & materials' WHEN 'fuel' THEN 'Fuel' WHEN 'tolls_parking' THEN 'Tolls & parking'
                                 WHEN 'equipment' THEN 'Tools & equipment' WHEN 'meals' THEN 'Meals' ELSE 'Expense' END
               || COALESCE(' — ' || v_e.vendor, '') || ' (receipt ' || to_char(v_e.expense_date, 'Mon DD') || ')';
    v_addons := v_addons || jsonb_build_object('id', v_line_id, 'kind', v_kind, 'label', v_label,
      'amount', v_e.amount, 'qty', NULL, 'rate', NULL, 'deduct', false, 'bill_client', false, 'pay_tech', true,
      'contractor_name', v_e.contractor_name);
  END IF;

  UPDATE work_orders SET pay_addons = v_addons, updated_at = now() WHERE id = v_wo.id;
  UPDATE job_expenses
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END, decided_at = now(),
         decline_reason = CASE WHEN p_approve THEN NULL ELSE NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '') END
   WHERE id = v_e.id;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'update', 'job_expense', v_e.id, jsonb_build_object('label',
    CASE WHEN p_approve THEN 'Approved' ELSE 'Declined' END || ' $' || v_e.amount || ' expense from ' || v_e.contractor_name || ' on WO#' || v_e.wo_number));
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_approve THEN 'approved' ELSE 'declined' END);
END;
$$;

REVOKE ALL ON FUNCTION public.wf_tech_add_expense(text, text, text, numeric, date, text, text),
  public.wf_tech_job_expenses(text), public.wf_owner_decide_expense(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_add_expense(text, text, text, numeric, date, text, text),
  public.wf_tech_job_expenses(text), public.wf_owner_decide_expense(uuid, boolean, text) TO authenticated;
