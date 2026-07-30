-- Migration 048: portal hardening + helper access grants
--
-- ─── What was wrong ───────────────────────────────────────────────────────────
--
-- The portal read path (get_portal_data) correctly hid Approved/Paid work
-- orders, but NONE of the write paths checked status. Findings:
--
--   1. update_portal_wo_status took an ARBITRARY status string with no
--      allowlist. A contractor could set their own work order to 'Approved' or
--      'Paid' — self-approving their own job — or reopen a closed one. This is
--      the most serious of the four.
--   2. save_portal_data verified the token and the assignment but not the
--      status, so tasks, Q&A, closeout notes, document appends and time logs
--      could all still be written to a closed job.
--   3. acknowledge_work_order had no status check, and matched only
--      contractor_name, ignoring the contractor_names array used on multi-tech
--      work orders.
--   4. get_portal_messages / send_portal_message let a contractor read and post
--      on closed jobs indefinitely.
--   5. One permanent token per contractor: no expiry, no revocation, and no way
--      to give a helper partial access.
--
-- ─── The model ────────────────────────────────────────────────────────────────
--
-- CLOSED means wo_status IN ('Approved','Paid') OR archived_at IS NOT NULL.
-- Once closed a portal user cannot see it, modify it, upload to it, or message
-- on it. 'Work Done' is deliberately NOT closed — the owner still reviews it and
-- the tech may need to fix something. 'Approved' is the owner accepting, and
-- that is the line.
--
-- Every token now resolves through ONE function, portal_resolve, which returns
-- the caller's identity plus their capability list. Capabilities are enforced
-- inside each RPC — server-side, never in the UI — so hiding a button is a
-- convenience, not the security boundary.

-- ─── Helper access grants ─────────────────────────────────────────────────────
-- A grant is a revocable, optionally-expiring token with an explicit capability
-- list, scoped to one contractor's work (and optionally to specific jobs).
CREATE TABLE IF NOT EXISTS portal_grants (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token         UUID        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  label         TEXT        NOT NULL,           -- "Mike — Dave's helper"
  -- Whose work this grant can see. Required: a helper always works under a tech.
  contractor_id UUID        NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  -- What they may do. See the capability list in portal_resolve.
  capabilities  TEXT[]      NOT NULL DEFAULT ARRAY['view']::text[],
  -- NULL = every job assigned to that contractor. Non-null narrows to these ids.
  scope_wo_ids  UUID[],
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE portal_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own portal grants" ON portal_grants;
CREATE POLICY "Users manage own portal grants"
  ON portal_grants FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_portal_grants_contractor ON portal_grants (contractor_id);

-- ─── One resolver for every token ─────────────────────────────────────────────
-- Returns NULL for anything invalid, revoked, expired, or malformed.
--
-- Capabilities:
--   view       see assigned work orders (baseline — without it, nothing)
--   tasks      tick off work order tasks
--   answers    answer custom questions
--   upload     upload photos and documents
--   documents  view / download / print attached documents
--   time       log travel, arrival, check in and check out
--   notes      write closeout notes
--   status     advance the job (In Progress / Work Done only — see below)
--   messages   read and send messages
--
-- A contractor using their own token gets the full set. Grants get exactly what
-- the owner picked.
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
  -- Malformed tokens return NULL rather than raising, so a bad token can't be
  -- distinguished from a wrong one by the error it produces.
  IF p_token IS NULL OR p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  v_uuid := p_token::uuid;

  -- A contractor's own token: full capabilities.
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

  -- Otherwise a helper grant, if it's still valid.
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
  JOIN contractors c ON c.id = g.contractor_id
  WHERE g.token = v_uuid
    AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at > NOW());

  RETURN v_out;  -- NULL when nothing matched
END;
$function$;

-- ─── Is this job still open to the portal? ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_wo_open(p_wo_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.id = p_wo_id
      AND w.archived_at IS NULL
      AND w.wo_status NOT IN ('Approved', 'Paid')
  );
$function$;

-- ─── Does this token reach this job, and may it do this? ──────────────────────
CREATE OR REPLACE FUNCTION public.portal_can(p_ctx jsonb, p_wo_id uuid, p_cap text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caps  text[];
  v_scope uuid[];
BEGIN
  IF p_ctx IS NULL THEN RETURN FALSE; END IF;

  v_caps := ARRAY(SELECT jsonb_array_elements_text(p_ctx->'capabilities'));
  IF NOT (p_cap = ANY(v_caps)) THEN RETURN FALSE; END IF;

  -- Closed jobs are closed to everyone holding a portal token.
  IF NOT portal_wo_open(p_wo_id) THEN RETURN FALSE; END IF;

  -- A grant may be narrowed to specific jobs.
  IF p_ctx->'scope_wo_ids' IS NOT NULL AND jsonb_typeof(p_ctx->'scope_wo_ids') = 'array' THEN
    v_scope := ARRAY(SELECT (jsonb_array_elements_text(p_ctx->'scope_wo_ids'))::uuid);
    IF NOT (p_wo_id = ANY(v_scope)) THEN RETURN FALSE; END IF;
  END IF;

  -- And the job must belong to this owner and be assigned to this contractor.
  RETURN EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.id      = p_wo_id
      AND w.user_id = (p_ctx->>'user_id')::uuid
      AND (
        w.contractor_name = (p_ctx->>'contractor_name')
        OR (p_ctx->>'contractor_name') = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
      )
  );
END;
$function$;

-- ─── Read: assigned, open work orders only, with money stripped ───────────────
CREATE OR REPLACE FUNCTION public.get_portal_data(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx         jsonb;
  v_contractor  jsonb;
  v_work_orders jsonb;
  v_scope       uuid[];
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN RETURN NULL; END IF;

  -- Banking, tax ID and the owner's private notes never leave the database.
  SELECT to_jsonb(c)
         - 'routing_number' - 'account_number' - 'account_type'
         - 'bank_name' - 'account_holder_name'
         - 'tax_id' - 'tax_id_type'
         - 'w9_file_path' - 'qbo_vendor_id' - 'notes'
         - 'portal_token'
    INTO v_contractor
  FROM contractors c
  WHERE c.id = (v_ctx->>'contractor_id')::uuid;

  IF v_contractor IS NULL THEN RETURN NULL; END IF;

  IF v_ctx->'scope_wo_ids' IS NOT NULL AND jsonb_typeof(v_ctx->'scope_wo_ids') = 'array' THEN
    v_scope := ARRAY(SELECT (jsonb_array_elements_text(v_ctx->'scope_wo_ids'))::uuid);
  END IF;

  SELECT jsonb_agg(
    (
      to_jsonb(w)
      - 'total_amount' - 'hourly_rate' - 'per_device_rate' - 'blended_base'
      - 'travel_amount' - 'bonus_amount' - 'pay_type'
      - 'contractor_pay' - 'expense_budget' - 'materials_used'
    )
    || jsonb_build_object(
        'is_lead', CASE
          WHEN w.lead_contractor_name IS NOT NULL
            THEN w.lead_contractor_name = (v_ctx->>'contractor_name')
          WHEN w.contractor_names IS NULL OR array_length(w.contractor_names, 1) <= 1
            THEN TRUE
          ELSE w.contractor_name = (v_ctx->>'contractor_name')
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
    AND ctl.contractor_name = (v_ctx->>'contractor_name')
  WHERE (
    w.contractor_name = (v_ctx->>'contractor_name')
    OR (v_ctx->>'contractor_name') = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
  )
    AND w.user_id     = (v_ctx->>'user_id')::uuid
    AND w.archived_at IS NULL
    AND w.wo_status NOT IN ('Approved', 'Paid')
    AND (v_scope IS NULL OR w.id = ANY(v_scope));

  -- Record that a helper link is in use, so stale grants are easy to spot.
  IF v_ctx->>'kind' = 'grant' THEN
    UPDATE portal_grants SET last_seen_at = NOW() WHERE id = (v_ctx->>'grant_id')::uuid;
  END IF;

  RETURN jsonb_build_object(
    'contractor',   v_contractor,
    'work_orders',  COALESCE(v_work_orders, '[]'::jsonb),
    -- The UI uses these to show only what this person may actually do.
    'capabilities', v_ctx->'capabilities',
    'display_name', v_ctx->>'display_name',
    'kind',         v_ctx->>'kind'
  );
END;
$function$;

-- ─── Write: capability + closed + assignment checked on every field ───────────
CREATE OR REPLACE FUNCTION public.save_portal_data(p_token text, p_wo_id uuid, p_field text, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx  jsonb;
  v_name text;
  v_cap  text;
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid token');
  END IF;
  v_name := v_ctx->>'contractor_name';

  -- Which capability does this field need?
  v_cap := CASE p_field
    WHEN 'wo_tasks'        THEN 'tasks'
    WHEN 'custom_qa'       THEN 'answers'
    WHEN 'closeout_notes'  THEN 'notes'
    WHEN 'doc_urls_append' THEN 'upload'
    WHEN 'travel_start'    THEN 'time'
    WHEN 'arrived'         THEN 'time'
    WHEN 'check_in'        THEN 'time'
    WHEN 'check_out'       THEN 'time'
    ELSE NULL
  END;

  IF v_cap IS NULL THEN
    RETURN jsonb_build_object('error', 'Unknown field: ' || p_field);
  END IF;

  -- One gate: capability held, job open, job assigned, owner matches, in scope.
  IF NOT portal_can(v_ctx, p_wo_id, v_cap) THEN
    RETURN jsonb_build_object('error', 'Not allowed');
  END IF;

  IF p_field = 'wo_tasks' THEN
    UPDATE work_orders SET wo_tasks = p_value WHERE id = p_wo_id;

  ELSIF p_field = 'custom_qa' THEN
    UPDATE work_orders SET custom_qa = p_value WHERE id = p_wo_id;

  ELSIF p_field = 'closeout_notes' THEN
    UPDATE work_orders SET closeout_notes = p_value->>'notes' WHERE id = p_wo_id;

  ELSIF p_field = 'doc_urls_append' THEN
    UPDATE work_orders
    SET doc_urls = array_append(COALESCE(doc_urls, ARRAY[]::text[]), p_value->>'url')
    WHERE id = p_wo_id;

  ELSIF p_field = 'travel_start' THEN
    INSERT INTO contractor_time_logs (wo_id, wo_number, contractor_name,
      travel_start_at, travel_start_lat, travel_start_lng)
    SELECT p_wo_id, w.wo_number, v_name,
      (p_value->>'timestamp')::timestamptz,
      CASE WHEN p_value->>'lat' IS NULL OR p_value->>'lat' = 'null' THEN NULL ELSE (p_value->>'lat')::float8 END,
      CASE WHEN p_value->>'lng' IS NULL OR p_value->>'lng' = 'null' THEN NULL ELSE (p_value->>'lng')::float8 END
    FROM work_orders w WHERE w.id = p_wo_id
    ON CONFLICT (wo_id, contractor_name) DO UPDATE SET
      travel_start_at = EXCLUDED.travel_start_at,
      travel_start_lat = EXCLUDED.travel_start_lat,
      travel_start_lng = EXCLUDED.travel_start_lng,
      updated_at = now();

  ELSIF p_field = 'arrived' THEN
    INSERT INTO contractor_time_logs (wo_id, wo_number, contractor_name,
      arrived_at, arrived_lat, arrived_lng)
    SELECT p_wo_id, w.wo_number, v_name,
      (p_value->>'timestamp')::timestamptz,
      CASE WHEN p_value->>'lat' IS NULL OR p_value->>'lat' = 'null' THEN NULL ELSE (p_value->>'lat')::float8 END,
      CASE WHEN p_value->>'lng' IS NULL OR p_value->>'lng' = 'null' THEN NULL ELSE (p_value->>'lng')::float8 END
    FROM work_orders w WHERE w.id = p_wo_id
    ON CONFLICT (wo_id, contractor_name) DO UPDATE SET
      arrived_at = EXCLUDED.arrived_at,
      arrived_lat = EXCLUDED.arrived_lat,
      arrived_lng = EXCLUDED.arrived_lng,
      updated_at = now();

  ELSIF p_field = 'check_in' THEN
    INSERT INTO contractor_time_logs (wo_id, wo_number, contractor_name, checked_in_at)
    SELECT p_wo_id, w.wo_number, v_name, (p_value->>'timestamp')::timestamptz
    FROM work_orders w WHERE w.id = p_wo_id
    ON CONFLICT (wo_id, contractor_name) DO UPDATE SET
      checked_in_at = EXCLUDED.checked_in_at, updated_at = now();

  ELSIF p_field = 'check_out' THEN
    INSERT INTO contractor_time_logs (wo_id, wo_number, contractor_name, checked_out_at)
    SELECT p_wo_id, w.wo_number, v_name, (p_value->>'timestamp')::timestamptz
    FROM work_orders w WHERE w.id = p_wo_id
    ON CONFLICT (wo_id, contractor_name) DO UPDATE SET
      checked_out_at = EXCLUDED.checked_out_at, updated_at = now();
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ─── Status: allowlisted. A tech can never approve or pay their own job. ──────
CREATE OR REPLACE FUNCTION public.update_portal_wo_status(p_token text, p_wo_id uuid, p_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx  jsonb;
  v_rows int;
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN RETURN FALSE; END IF;

  -- The whole point: 'Approved' and 'Paid' are the OWNER's decisions. Accepting
  -- an arbitrary string here let a contractor mark their own work approved.
  IF p_status NOT IN ('In Progress', 'Work Done') THEN
    RETURN FALSE;
  END IF;

  IF NOT portal_can(v_ctx, p_wo_id, 'status') THEN RETURN FALSE; END IF;

  UPDATE work_orders
     SET wo_status = p_status, updated_at = NOW()
   WHERE id = p_wo_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

-- ─── Acknowledge: honours multi-tech assignment, refuses closed jobs ──────────
CREATE OR REPLACE FUNCTION public.acknowledge_work_order(p_wo_id uuid, p_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx  jsonb;
  v_rows int;
BEGIN
  v_ctx := portal_resolve(p_token::text);
  IF v_ctx IS NULL THEN RETURN FALSE; END IF;

  -- 'view' is the baseline capability: acknowledging is just confirming receipt.
  IF NOT portal_can(v_ctx, p_wo_id, 'view') THEN RETURN FALSE; END IF;

  UPDATE work_orders
     SET acknowledged_at = NOW(),
         wo_status = CASE WHEN wo_status IN ('Open','Assigned') THEN 'Assigned'::text ELSE wo_status::text END,
         updated_at = NOW()
   WHERE id = p_wo_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

-- ─── Messages: capability-gated, and closed jobs go quiet ─────────────────────
CREATE OR REPLACE FUNCTION public.get_portal_messages(p_token text, p_wo_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx      jsonb;
  v_wo_id    uuid;
  v_messages jsonb;
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN RETURN NULL; END IF;

  SELECT w.id INTO v_wo_id
  FROM work_orders w
  WHERE w.wo_number = p_wo_number
    AND w.user_id = (v_ctx->>'user_id')::uuid
  LIMIT 1;

  IF v_wo_id IS NULL OR NOT portal_can(v_ctx, v_wo_id, 'messages') THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at ASC)
  INTO v_messages
  FROM work_order_messages m
  WHERE m.work_order_id = p_wo_number
    AND m.user_id = (v_ctx->>'user_id')::uuid;

  RETURN COALESCE(v_messages, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_portal_message(p_token text, p_wo_number text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx     jsonb;
  v_wo_id   uuid;
  v_email   text;
  v_message jsonb;
BEGIN
  v_ctx := portal_resolve(p_token);
  IF v_ctx IS NULL THEN RETURN NULL; END IF;

  SELECT w.id INTO v_wo_id
  FROM work_orders w
  WHERE w.wo_number = p_wo_number
    AND w.user_id = (v_ctx->>'user_id')::uuid
  LIMIT 1;

  IF v_wo_id IS NULL OR NOT portal_can(v_ctx, v_wo_id, 'messages') THEN
    RETURN NULL;
  END IF;

  SELECT c.email INTO v_email FROM contractors c WHERE c.id = (v_ctx->>'contractor_id')::uuid;

  INSERT INTO work_order_messages (user_id, work_order_id, sender_email, sender_name, sender_role, content)
  VALUES (
    (v_ctx->>'user_id')::uuid,
    p_wo_number,
    v_email,
    v_ctx->>'display_name',   -- a helper posts under their own name, not the tech's
    'contractor',
    p_content
  )
  RETURNING to_jsonb(work_order_messages.*) INTO v_message;

  RETURN v_message;
END;
$function$;
