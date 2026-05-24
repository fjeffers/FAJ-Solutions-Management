-- Migration 021: Portal security hardening
--
-- Two changes to get_portal_data:
--
-- 1. PAYMENT FIELDS STRIPPED — contractors must never see payment amounts.
--    Uses jsonb `-` operator to remove financial keys from the WO object
--    before it leaves the database. Even if a future client component
--    accidentally exposes data, these fields will simply not exist.
--
--    Fields removed: total_amount, hourly_rate, per_device_rate,
--                    blended_base, travel_amount, bonus_amount, pay_type
--
-- 2. APPROVED WOs HIDDEN — once a WO reaches "Approved" status (work done
--    and payment processed) it no longer appears in the contractor portal.
--    Contractors only see jobs that still require action from them.
--    Status filter: NOT IN ('Approved', 'Paid')

CREATE OR REPLACE FUNCTION get_portal_data(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contractor  jsonb;
  v_work_orders jsonb;
BEGIN
  SELECT to_jsonb(c) INTO v_contractor
  FROM contractors c
  WHERE c.portal_token = p_token::uuid;

  IF v_contractor IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(
    -- Strip all financial/payment fields from the work order before returning.
    -- Contractors must only see job information, never payment amounts or rates.
    (
      to_jsonb(w)
      - 'total_amount'
      - 'hourly_rate'
      - 'per_device_rate'
      - 'blended_base'
      - 'travel_amount'
      - 'bonus_amount'
      - 'pay_type'
    )
    || jsonb_build_object(
        'is_lead', CASE
          WHEN w.lead_contractor_name IS NOT NULL
            THEN w.lead_contractor_name = (v_contractor->>'name')
          WHEN w.contractor_names IS NULL OR array_length(w.contractor_names, 1) <= 1
            THEN TRUE
          ELSE w.contractor_name = (v_contractor->>'name')
        END,
        'travel_start_at',  CASE WHEN ctl.id IS NOT NULL THEN ctl.travel_start_at  ELSE w.travel_start_at  END,
        'travel_start_lat', CASE WHEN ctl.id IS NOT NULL THEN ctl.travel_start_lat ELSE w.travel_start_lat END,
        'travel_start_lng', CASE WHEN ctl.id IS NOT NULL THEN ctl.travel_start_lng ELSE w.travel_start_lng END,
        'arrived_at',       CASE WHEN ctl.id IS NOT NULL THEN ctl.arrived_at       ELSE w.arrived_at       END,
        'arrived_lat',      CASE WHEN ctl.id IS NOT NULL THEN ctl.arrived_lat      ELSE w.arrived_lat      END,
        'arrived_lng',      CASE WHEN ctl.id IS NOT NULL THEN ctl.arrived_lng      ELSE w.arrived_lng      END,
        'checked_in_at',    CASE WHEN ctl.id IS NOT NULL THEN ctl.checked_in_at    ELSE w.checked_in_at    END,
        'checked_out_at',   CASE WHEN ctl.id IS NOT NULL THEN ctl.checked_out_at   ELSE w.checked_out_at   END
    )
    ORDER BY COALESCE(w.start_date::text, '9999-12-31') ASC, w.created_at ASC
  )
  INTO v_work_orders
  FROM work_orders w
  LEFT JOIN contractor_time_logs ctl
    ON  ctl.wo_id           = w.id
    AND ctl.contractor_name = (v_contractor->>'name')
  WHERE (
    w.contractor_name = (v_contractor->>'name')
    OR (v_contractor->>'name') = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
  )
    AND w.user_id    = (v_contractor->>'user_id')::uuid
    AND w.wo_status NOT IN ('Approved', 'Paid');   -- ← hide completed WOs

  RETURN jsonb_build_object(
    'contractor',  v_contractor,
    'work_orders', COALESCE(v_work_orders, '[]'::jsonb)
  );
END;
$$;
