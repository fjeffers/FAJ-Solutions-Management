-- =============================================================================
-- Migration 137: expense categories, Fred's list plus his own
-- =============================================================================
-- Fred, 2026-10-21 (from the client's app he showed us): "Mileage, Meals,
-- Lodging, Travel, Labor, Materials, Rental" and "+ Add new expense category".
--
-- 1. expense_categories: every category a receipt can have. The built-in ones
--    (seeded here, labels shown by lib/expenses.ts) and the ones the office adds
--    (key c_…). Keys never change, so old receipts keep theirs: 'hotel' is
--    shown as Lodging.
-- 2. job_expenses.category: the fixed CHECK (migration 117) becomes a foreign key.
-- 3. wf_tech_add_expense / wf_owner_add_expense: any active category.
-- 4. wf_owner_add_expense_category / wf_owner_hide_expense_category: the office
--    adds one, or hides one it added (receipts already filed under it keep it).
-- 5. wf_owner_decide_expense: the pay line is labelled from the table.
--
-- Safe to re-run.

-- ── 1. The categories ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.expense_categories (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,41}$'),
  label      text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 40),
  builtin    boolean NOT NULL DEFAULT false,
  sort       int NOT NULL DEFAULT 1000,
  active     boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fred's list first, then the ones receipts already use.
INSERT INTO public.expense_categories (key, label, builtin, sort) VALUES
  ('mileage', 'Mileage', true, 10),
  ('meals', 'Meals', true, 20),
  ('hotel', 'Lodging', true, 30),
  ('travel', 'Travel', true, 40),
  ('labor', 'Labor', true, 50),
  ('materials', 'Materials', true, 60),
  ('rental', 'Rental', true, 70),
  ('fuel', 'Fuel', true, 80),
  ('tolls_parking', 'Tolls & parking', true, 90),
  ('equipment', 'Tools & equipment', true, 100),
  ('other', 'Other', true, 110)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, builtin = true, sort = EXCLUDED.sort, active = true;

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_categories_read ON public.expense_categories;
-- Everyone signed in reads the list (techs pick from it). Writes only through the functions below.
CREATE POLICY expense_categories_read ON public.expense_categories FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.expense_categories FROM anon, authenticated;
GRANT SELECT ON public.expense_categories TO authenticated;

-- ── 2. A receipt's category comes from the table ────────────────────────────

ALTER TABLE public.job_expenses DROP CONSTRAINT IF EXISTS job_expenses_category_check;
ALTER TABLE public.job_expenses DROP CONSTRAINT IF EXISTS job_expenses_category_fkey;
ALTER TABLE public.job_expenses ADD CONSTRAINT job_expenses_category_fkey
  FOREIGN KEY (category) REFERENCES public.expense_categories (key);

-- ── 3. Adding a receipt: any active category ────────────────────────────────

CREATE OR REPLACE FUNCTION public.wf_tech_add_expense(p_wo_number text, p_category text, p_vendor text, p_amount numeric, p_date date, p_note text, p_receipt_path text)
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
  IF NOT EXISTS (SELECT 1 FROM expense_categories WHERE key = p_category AND active) THEN
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

CREATE OR REPLACE FUNCTION public.wf_owner_add_expense(
  p_wo_id uuid, p_category text, p_vendor text, p_amount numeric, p_date date, p_note text, p_receipt_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_wo work_orders%ROWTYPE;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  SELECT * INTO v_wo FROM work_orders WHERE id = p_wo_id AND user_id = auth.uid();
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM expense_categories WHERE key = p_category AND active) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_category');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount >= 10000 THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount'); END IF;
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE 'America/New_York')::date + 1 OR p_date < (now() - interval '400 days')::date THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_date');
  END IF;
  IF p_receipt_path IS NOT NULL AND p_receipt_path !~ ('^' || v_wo.id::text || '/[0-9a-z_-]+\.(jpg|png|pdf)$') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_file');
  END IF;

  INSERT INTO job_expenses (user_id, wo_id, wo_number, contractor_name, category, vendor, amount, expense_date, note,
                            receipt_path, status, decided_at, paid_by)
  VALUES (auth.uid(), v_wo.id, v_wo.wo_number, 'Office', p_category,
          NULLIF(left(btrim(COALESCE(p_vendor, '')), 120), ''), round(p_amount, 2), p_date,
          NULLIF(left(btrim(COALESCE(p_note, '')), 1000), ''), p_receipt_path, 'approved', now(), 'faj')
  RETURNING id INTO v_id;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'create', 'job_expense', v_id, jsonb_build_object('label',
    'Office added $' || round(p_amount, 2) || ' ' || p_category || ' receipt on WO#' || v_wo.wo_number));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_owner_add_expense(uuid, text, text, numeric, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_owner_add_expense(uuid, text, text, numeric, date, text, text) TO authenticated;

-- ── 4. The office's own categories ──────────────────────────────────────────

-- "Tool rental" → c_tool_rental. A name that matches a category already there
-- (built in or the office's, hidden or not) gives that one back, shown again.
CREATE OR REPLACE FUNCTION public.wf_owner_add_expense_category(p_label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_label text := left(regexp_replace(btrim(COALESCE(p_label, '')), '\s+', ' ', 'g'), 40);
  v_slug text;
  v_key text;
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  v_slug := left(btrim(regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g'), '_'), 40);
  IF v_slug = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_label'); END IF;

  SELECT key INTO v_key FROM expense_categories WHERE lower(label) = lower(v_label) OR key = 'c_' || v_slug ORDER BY builtin DESC LIMIT 1;
  IF v_key IS NOT NULL THEN
    UPDATE expense_categories SET active = true WHERE key = v_key AND NOT builtin AND NOT active;
    RETURN jsonb_build_object('ok', true, 'key', v_key, 'existing', true);
  END IF;
  IF (SELECT count(*) FROM expense_categories WHERE NOT builtin AND active) >= 50 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many');
  END IF;

  v_key := 'c_' || v_slug;
  INSERT INTO expense_categories (key, label, builtin, sort, created_by) VALUES (v_key, v_label, false, 1000, auth.uid());
  RETURN jsonb_build_object('ok', true, 'key', v_key);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_owner_add_expense_category(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_owner_add_expense_category(text) TO authenticated;

-- Hidden from the pickers; receipts already filed under it keep it. Built-in ones stay.
CREATE OR REPLACE FUNCTION public.wf_owner_hide_expense_category(p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  UPDATE expense_categories SET active = false WHERE key = p_key AND NOT builtin;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_owner_hide_expense_category(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_owner_hide_expense_category(text) TO authenticated;

-- ── 5. Approving: the pay line takes the category's name ────────────────────

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
  -- The office's own receipt: no tech to pay back, nothing to decide.
  IF v_e.paid_by = 'faj' THEN RETURN jsonb_build_object('ok', false, 'reason', 'office_expense'); END IF;
  SELECT * INTO v_wo FROM work_orders WHERE id = v_e.wo_id AND user_id = auth.uid() FOR UPDATE;
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  v_line_id := 'exp_' || v_e.id::text;
  v_addons := COALESCE((SELECT jsonb_agg(a) FROM jsonb_array_elements(COALESCE(v_wo.pay_addons, '[]'::jsonb)) a
                         WHERE a ->> 'id' IS DISTINCT FROM v_line_id), '[]'::jsonb);

  IF p_approve THEN
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
                                WHEN 'equipment' THEN 'equipment' WHEN 'meals' THEN 'per_diem' WHEN 'mileage' THEN 'mileage' ELSE 'other' END;
    v_label := COALESCE((SELECT label FROM expense_categories WHERE key = v_e.category), 'Expense')
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
