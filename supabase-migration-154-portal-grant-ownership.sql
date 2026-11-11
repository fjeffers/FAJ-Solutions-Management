-- Migration 154: a helper link only works for a tech the link's creator owns.
--
-- portal_grants checked that user_id was the caller, but never that the
-- contractor_id belonged to that same owner. Any signed-in login (a tech can
-- get coworkers' contractor ids from tech_directory) could insert a grant for
-- another tech and read that tech's profile through get_portal_data.
--
--   portal_grants policy  WITH CHECK also requires the contractor to be owned
--                         by auth.uid() (portal_owns_contractor); user_id now
--                         defaults to auth.uid()
--   existing bad grants   revoked
--   portal_resolve        a grant resolves only when c.user_id = g.user_id
--   get_portal_data       returns an explicit contractor column list instead of
--                         to_jsonb(c) minus a deny list; helper links get only
--                         id and name
--
-- Safe to run more than once, after migration 153.

ALTER TABLE portal_grants ALTER COLUMN user_id SET DEFAULT auth.uid();

-- SECURITY DEFINER so the check doesn't depend on RLS on contractors. It only
-- answers for the caller's own contractors, so it reveals nothing else.
CREATE OR REPLACE FUNCTION public.portal_owns_contractor(p_contractor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM contractors c
    WHERE c.id = p_contractor_id
      AND c.user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "Users manage own portal grants" ON portal_grants;
CREATE POLICY "Users manage own portal grants"
  ON portal_grants FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND portal_owns_contractor(contractor_id));

UPDATE portal_grants g
   SET revoked_at = NOW(), updated_at = NOW()
 WHERE g.revoked_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM contractors c
     WHERE c.id = g.contractor_id
       AND c.user_id = g.user_id
   );

CREATE OR REPLACE FUNCTION public.portal_resolve(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uuid uuid;
  v_out  jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  v_uuid := p_token::uuid;

  SELECT jsonb_build_object(
           'kind',            'contractor',
           'user_id',         c.user_id,
           'contractor_id',   c.id,
           'contractor_name', c.name,
           'display_name',    c.name,
           'capabilities',    to_jsonb(ARRAY['view','tasks','answers','upload','documents','time','notes','status','messages']),
           'scope_wo_ids',    NULL::jsonb
         )
    INTO v_out
  FROM contractors c
  WHERE c.portal_token = v_uuid;

  IF v_out IS NOT NULL THEN RETURN v_out; END IF;

  SELECT jsonb_build_object(
           'kind',            'grant',
           'grant_id',        g.id,
           'user_id',         g.user_id,
           'contractor_id',   c.id,
           'contractor_name', c.name,
           'display_name',    g.label,
           'capabilities',    to_jsonb(g.capabilities),
           'scope_wo_ids',    CASE WHEN g.scope_wo_ids IS NULL THEN NULL ELSE to_jsonb(g.scope_wo_ids) END
         )
    INTO v_out
  FROM portal_grants g
  JOIN contractors c ON c.id = g.contractor_id AND c.user_id = g.user_id
  WHERE g.token = v_uuid
    AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at > NOW());

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_portal_data(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb; v_contractor jsonb; v_work_orders jsonb; v_scope uuid[];
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN RETURN NULL; END IF;

  -- Only what the portal page shows. Paperwork status is the tech's own, so a
  -- helper link gets the tech's name and nothing else.
  SELECT CASE WHEN v_ctx->>'kind' = 'contractor' THEN
           jsonb_build_object(
             'id', c.id, 'name', c.name,
             'w9_received', c.w9_received, 'w9_submitted_at', c.w9_submitted_at,
             'contract_url', c.contract_url, 'contract_signed_at', c.contract_signed_at,
             'contract_signed_name', c.contract_signed_name)
         ELSE jsonb_build_object('id', c.id, 'name', c.name)
         END
    INTO v_contractor FROM contractors c
   WHERE c.id = (v_ctx->>'contractor_id')::uuid
     AND c.user_id = (v_ctx->>'user_id')::uuid;
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
