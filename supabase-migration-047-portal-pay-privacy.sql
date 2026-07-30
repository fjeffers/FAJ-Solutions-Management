-- Migration 047: stop the contractor portal leaking pay and banking details
--
-- SECURITY FIX. get_portal_data already stripped the client-facing price
-- (total_amount, hourly_rate, per_device_rate, blended_base, travel_amount,
-- bonus_amount, pay_type) but three things were still going out to any tech
-- holding a portal link — a URL token, with no login:
--
--   1. work_orders.contractor_pay — the name→amount map. A tech could see not
--      just their own pay but EVERY other tech's pay on that job. Wages of
--      other people are the most sensitive thing on the work order.
--   2. The entire contractors row via to_jsonb(c), including routing_number,
--      account_number, bank_name, account_holder_name, and tax_id / tax_id_type
--      (an SSN or EIN). If a portal link is forwarded, so are the bank details.
--   3. contractors.notes — the owner's private notes about that contractor.
--
-- Also stripped from work orders: expense_budget (a money figure the tech has
-- no business seeing) and materials_used (carries unit costs).
--
-- What techs still get: the job, the site, the schedule, the scope, tasks, Q&A,
-- their own check-in/out and travel times. Everything needed to do the work and
-- log it — nothing about money.

CREATE OR REPLACE FUNCTION public.get_portal_data(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contractor  jsonb;
  v_work_orders jsonb;
BEGIN
  -- Only the fields a tech needs to see about themselves. Banking, tax ID and
  -- the owner's private notes never leave the database.
  SELECT to_jsonb(c)
         - 'routing_number'
         - 'account_number'
         - 'account_type'
         - 'bank_name'
         - 'account_holder_name'
         - 'tax_id'
         - 'tax_id_type'
         - 'w9_file_path'
         - 'qbo_vendor_id'
         - 'notes'
    INTO v_contractor
  FROM contractors c
  WHERE c.portal_token = p_token::uuid;

  IF v_contractor IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(
    (
      to_jsonb(w)
      - 'total_amount'
      - 'hourly_rate'
      - 'per_device_rate'
      - 'blended_base'
      - 'travel_amount'
      - 'bonus_amount'
      - 'pay_type'
      - 'contractor_pay'     -- every tech's wages; never expose
      - 'expense_budget'
      - 'materials_used'     -- carries unit costs
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
    AND w.wo_status NOT IN ('Approved', 'Paid');

  RETURN jsonb_build_object(
    'contractor',  v_contractor,
    'work_orders', COALESCE(v_work_orders, '[]'::jsonb)
  );
END;
$function$;
