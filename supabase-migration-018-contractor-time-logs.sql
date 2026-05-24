-- Migration 018: Per-contractor time logs
-- Creates contractor_time_logs table so each tech on a multi-contractor WO
-- gets their own independent travel / arrived / check-in / check-out record.
-- Also rewrites save_portal_data and get_portal_data to use the new table.

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contractor_time_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id             uuid        NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  wo_number         text        NOT NULL,
  contractor_name   text        NOT NULL,
  travel_start_at   timestamptz,
  travel_start_lat  float8,
  travel_start_lng  float8,
  arrived_at        timestamptz,
  arrived_lat       float8,
  arrived_lng       float8,
  checked_in_at     timestamptz,
  checked_out_at    timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE(wo_id, contractor_name)
);

ALTER TABLE contractor_time_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read" ON contractor_time_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM work_orders w WHERE w.id = wo_id AND w.user_id = auth.uid()
  ));

CREATE POLICY "owner_write" ON contractor_time_logs FOR ALL
  USING (EXISTS (
    SELECT 1 FROM work_orders w WHERE w.id = wo_id AND w.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM work_orders w WHERE w.id = wo_id AND w.user_id = auth.uid()
  ));

-- ─── save_portal_data ─────────────────────────────────────────────────────────
-- Routes all 4 time fields (travel_start, arrived, check_in, check_out)
-- to contractor_time_logs via UPSERT instead of the shared work_orders columns.
-- Also fixes legacy bugs: auth check now uses text-based contractor_name columns;
-- doc_urls_append now uses array_append() on text[] instead of jsonb ops.

CREATE OR REPLACE FUNCTION save_portal_data(
  p_token  text,
  p_wo_id  uuid,
  p_field  text,
  p_value  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contractor_name text;
  v_valid           boolean;
BEGIN
  -- Resolve contractor name from portal token
  SELECT c.name INTO v_contractor_name
  FROM contractors c
  WHERE c.portal_token = p_token::uuid
  LIMIT 1;

  IF v_contractor_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid token');
  END IF;

  -- Verify this contractor is assigned to the WO
  SELECT EXISTS (
    SELECT 1 FROM work_orders
    WHERE id = p_wo_id
      AND (
        contractor_name = v_contractor_name
        OR v_contractor_name = ANY(COALESCE(contractor_names, ARRAY[]::text[]))
      )
  ) INTO v_valid;

  IF NOT v_valid THEN
    RETURN jsonb_build_object('error', 'Not authorized');
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
    SELECT p_wo_id, w.wo_number, v_contractor_name,
      (p_value->>'timestamp')::timestamptz,
      CASE WHEN p_value->>'lat' IS NULL OR p_value->>'lat' = 'null' THEN NULL
           ELSE (p_value->>'lat')::float8 END,
      CASE WHEN p_value->>'lng' IS NULL OR p_value->>'lng' = 'null' THEN NULL
           ELSE (p_value->>'lng')::float8 END
    FROM work_orders w WHERE w.id = p_wo_id
    ON CONFLICT (wo_id, contractor_name) DO UPDATE SET
      travel_start_at  = EXCLUDED.travel_start_at,
      travel_start_lat = EXCLUDED.travel_start_lat,
      travel_start_lng = EXCLUDED.travel_start_lng,
      updated_at       = now();

  ELSIF p_field = 'arrived' THEN
    INSERT INTO contractor_time_logs (wo_id, wo_number, contractor_name,
        arrived_at, arrived_lat, arrived_lng)
    SELECT p_wo_id, w.wo_number, v_contractor_name,
      (p_value->>'timestamp')::timestamptz,
      CASE WHEN p_value->>'lat' IS NULL OR p_value->>'lat' = 'null' THEN NULL
           ELSE (p_value->>'lat')::float8 END,
      CASE WHEN p_value->>'lng' IS NULL OR p_value->>'lng' = 'null' THEN NULL
           ELSE (p_value->>'lng')::float8 END
    FROM work_orders w WHERE w.id = p_wo_id
    ON CONFLICT (wo_id, contractor_name) DO UPDATE SET
      arrived_at  = EXCLUDED.arrived_at,
      arrived_lat = EXCLUDED.arrived_lat,
      arrived_lng = EXCLUDED.arrived_lng,
      updated_at  = now();

  ELSIF p_field = 'check_in' THEN
    INSERT INTO contractor_time_logs (wo_id, wo_number, contractor_name, checked_in_at)
    SELECT p_wo_id, w.wo_number, v_contractor_name,
      (p_value->>'timestamp')::timestamptz
    FROM work_orders w WHERE w.id = p_wo_id
    ON CONFLICT (wo_id, contractor_name) DO UPDATE SET
      checked_in_at = EXCLUDED.checked_in_at,
      updated_at    = now();

  ELSIF p_field = 'check_out' THEN
    INSERT INTO contractor_time_logs (wo_id, wo_number, contractor_name, checked_out_at)
    SELECT p_wo_id, w.wo_number, v_contractor_name,
      (p_value->>'timestamp')::timestamptz
    FROM work_orders w WHERE w.id = p_wo_id
    ON CONFLICT (wo_id, contractor_name) DO UPDATE SET
      checked_out_at = EXCLUDED.checked_out_at,
      updated_at     = now();

  ELSE
    RETURN jsonb_build_object('error', 'Unknown field: ' || p_field);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─── get_portal_data ──────────────────────────────────────────────────────────
-- LEFT JOINs contractor_time_logs to inject per-contractor time values into
-- the returned WO objects. If a log row exists for this contractor, its values
-- are used exclusively (prevents leaking another contractor's timestamps on
-- multi-tech WOs). If no log row exists, falls back to the legacy work_orders
-- columns for backward compatibility with single-contractor WOs.

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
    to_jsonb(w)
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
    AND w.wo_status NOT IN ('Paid');

  RETURN jsonb_build_object(
    'contractor',  v_contractor,
    'work_orders', COALESCE(v_work_orders, '[]'::jsonb)
  );
END;
$$;
