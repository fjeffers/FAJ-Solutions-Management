-- Migration 110: custom fields on jobs, techs and customers — and the emailed
-- tech portal link stops sending money it shouldn't
--
-- 1. Custom fields (Settings -> Custom fields; Fred, 2026-10-05: "full admin
--    privilege in settings"). Fred defines his own boxes; the definitions live
--    in user_settings.fields and each record keeps its answers in `custom`,
--    keyed by the field's id. Office only: techs never see them (below).
--
-- 2. get_portal_data (the tech's emailed portal link) sends each job as the
--    whole row minus a list of money columns. Columns added after that list
--    was written went to techs too: what FAJ bills the client for travel,
--    materials, other charges and miles (billable_*), and pay_addons (billed
--    lines and every tech's pay lines). Fred's rule: techs never see job
--    money. Those are now stripped, with payment_terms, review_history,
--    assignment_responses, time_requests and the new custom fields. The portal
--    page uses none of them. The contractor record also drops `custom`.

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS custom JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS custom JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE customers   ADD COLUMN IF NOT EXISTS custom JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_custom_size;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_custom_size CHECK (pg_column_size(custom) < 32768);
ALTER TABLE contractors DROP CONSTRAINT IF EXISTS contractors_custom_size;
ALTER TABLE contractors ADD CONSTRAINT contractors_custom_size CHECK (pg_column_size(custom) < 32768);
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_custom_size;
ALTER TABLE customers ADD CONSTRAINT customers_custom_size CHECK (pg_column_size(custom) < 32768);

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE user_settings DROP CONSTRAINT IF EXISTS user_settings_fields_size;
ALTER TABLE user_settings ADD CONSTRAINT user_settings_fields_size CHECK (pg_column_size(fields) < 65536);

CREATE OR REPLACE FUNCTION public.get_portal_data(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ctx jsonb; v_contractor jsonb; v_work_orders jsonb; v_scope uuid[];
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN RETURN NULL; END IF;

  SELECT to_jsonb(c)
         - 'routing_number' - 'account_number' - 'account_type'
         - 'bank_name' - 'account_holder_name' - 'tax_id' - 'tax_id_type'
         - 'w9_file_path' - 'qbo_vendor_id' - 'notes' - 'portal_token'
         - 'custom'
    INTO v_contractor FROM contractors c WHERE c.id = (v_ctx->>'contractor_id')::uuid;
  IF v_contractor IS NULL THEN RETURN NULL; END IF;

  IF v_ctx->'scope_wo_ids' IS NOT NULL AND jsonb_typeof(v_ctx->'scope_wo_ids') = 'array' THEN
    v_scope := ARRAY(SELECT (jsonb_array_elements_text(v_ctx->'scope_wo_ids'))::uuid);
  END IF;

  SELECT jsonb_agg(
    (to_jsonb(w)
      - 'total_amount' - 'hourly_rate' - 'per_device_rate' - 'blended_base'
      - 'travel_amount' - 'bonus_amount' - 'pay_type'
      - 'contractor_pay' - 'expense_budget' - 'materials_used'
      - 'billable_travel' - 'billable_materials' - 'billable_other' - 'billable_miles'
      - 'pay_addons' - 'payment_terms' - 'review_history' - 'assignment_responses'
      - 'time_requests' - 'custom')
    || jsonb_build_object(
        'is_lead', CASE
          WHEN w.lead_contractor_name IS NOT NULL THEN w.lead_contractor_name = (v_ctx->>'contractor_name')
          WHEN w.contractor_names IS NULL OR array_length(w.contractor_names,1) <= 1 THEN TRUE
          ELSE w.contractor_name = (v_ctx->>'contractor_name') END,
        'travel_start_at',  CASE WHEN ctl.id IS NOT NULL THEN ctl.travel_start_at  ELSE w.travel_start_at  END,
        'travel_start_lat', CASE WHEN ctl.id IS NOT NULL THEN ctl.travel_start_lat ELSE w.travel_start_lat END,
        'travel_start_lng', CASE WHEN ctl.id IS NOT NULL THEN ctl.travel_start_lng ELSE w.travel_start_lng END,
        'arrived_at',       CASE WHEN ctl.id IS NOT NULL THEN ctl.arrived_at       ELSE w.arrived_at       END,
        'arrived_lat',      CASE WHEN ctl.id IS NOT NULL THEN ctl.arrived_lat      ELSE w.arrived_lat      END,
        'arrived_lng',      CASE WHEN ctl.id IS NOT NULL THEN ctl.arrived_lng      ELSE w.arrived_lng      END,
        'checked_in_at',    CASE WHEN ctl.id IS NOT NULL THEN ctl.checked_in_at    ELSE w.checked_in_at    END,
        'checked_out_at',   CASE WHEN ctl.id IS NOT NULL THEN ctl.checked_out_at   ELSE w.checked_out_at   END)
    ORDER BY COALESCE(w.start_date::text,'9999-12-31') ASC, w.created_at ASC)
  INTO v_work_orders
  FROM work_orders w
  LEFT JOIN contractor_time_logs ctl ON ctl.wo_id = w.id AND ctl.contractor_name = (v_ctx->>'contractor_name')
  WHERE (w.contractor_name = (v_ctx->>'contractor_name')
         OR (v_ctx->>'contractor_name') = ANY(COALESCE(w.contractor_names, ARRAY[]::text[])))
    AND w.user_id = (v_ctx->>'user_id')::uuid
    AND w.archived_at IS NULL
    AND w.wo_status NOT IN ('Approved','Paid')
    AND (v_scope IS NULL OR w.id = ANY(v_scope));

  IF v_ctx->>'kind' = 'grant' THEN
    UPDATE portal_grants SET last_seen_at = NOW() WHERE id = (v_ctx->>'grant_id')::uuid;
  END IF;

  RETURN jsonb_build_object('contractor', v_contractor,
    'work_orders', COALESCE(v_work_orders,'[]'::jsonb),
    'capabilities', v_ctx->'capabilities',
    'display_name', v_ctx->>'display_name',
    'kind', v_ctx->>'kind');
END;
$function$;
