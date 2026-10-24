-- =============================================================================
-- Migration 138: no pay reaches a tech's login
-- =============================================================================
-- Fred, 2026-10-22: "techs shouldn't see money for pay anywhere". The tech app
-- no longer has Pay history; this makes sure the database doesn't hand pay to a
-- tech login either (a phone could still call these functions directly).
--
--   tech_my_payments()    nothing (was every payment with its amount)
--   tech_my_summary()     job counts only (was paid this year / all time)
--   tech_crew_payments()  nothing (was crew payments to the lead)
--   tech_me()             without default_hourly_rate
--   get_portal_data()     the emailed portal's contractor record without
--                         default_hourly_rate (work order pay was already removed)
--
-- The office screens read pay from the tables directly, so nothing changes there.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.tech_my_payments()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF tech_ctx() IS NULL THEN RETURN NULL; END IF;
  RETURN '[]'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_my_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'jobs_total', (SELECT COUNT(*) FROM work_orders w
                    WHERE w.user_id = (v_ctx->>'owner_id')::uuid
                      AND (w.contractor_name = (v_ctx->>'contractor_name')
                           OR (v_ctx->>'contractor_name') = ANY(COALESCE(w.contractor_names, ARRAY[]::text[])))),
    'jobs_open', (SELECT COUNT(*) FROM work_orders w
                   WHERE w.user_id = (v_ctx->>'owner_id')::uuid
                     AND (w.contractor_name = (v_ctx->>'contractor_name')
                          OR (v_ctx->>'contractor_name') = ANY(COALESCE(w.contractor_names, ARRAY[]::text[])))
                     AND w.wo_status NOT IN ('Approved','Paid')
                     AND w.archived_at IS NULL)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_crew_payments()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN '[]'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_me()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx(); v_out jsonb;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone,
    'business_name', c.business_name, 'entity_type', c.entity_type,
    'address', c.address, 'city', c.city, 'state', c.state, 'zip', c.zip,
    'payment_method', c.payment_method,
    'w9_received', c.w9_received, 'w9_submitted_at', c.w9_submitted_at,
    'contract_signed_at', c.contract_signed_at,
    'portal_last_login_at', c.portal_last_login_at, 'created_at', c.created_at,
    'emergency_name', c.emergency_name, 'emergency_phone', c.emergency_phone,
    'emergency_relation', c.emergency_relation, 'hire_date', c.hire_date
  ) INTO v_out FROM contractors c WHERE c.id = (v_ctx->>'contractor_id')::uuid;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_portal_data(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb; v_contractor jsonb; v_work_orders jsonb; v_scope uuid[];
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN RETURN NULL; END IF;

  SELECT to_jsonb(c)
         - 'routing_number' - 'account_number' - 'account_type'
         - 'bank_name' - 'account_holder_name' - 'tax_id' - 'tax_id_type'
         - 'w9_file_path' - 'qbo_vendor_id' - 'notes' - 'portal_token'
         - 'custom' - 'default_hourly_rate'
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
      - 'time_requests' - 'custom' - 'board_stage')
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
$$;
