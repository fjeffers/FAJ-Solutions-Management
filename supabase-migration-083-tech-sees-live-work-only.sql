-- 083: a tech's job list is live work only.
--
-- The portal grew three layers of "finished": migration-077 moved a Work Done
-- job into the tech's history, migration-080 hid it from them entirely, and
-- the history still held every closed job as a card. Fred: "the tech portals
-- see the work orders that already done or closed" — and they should not.
--
-- So My Jobs is now exactly what is still theirs to do. Nothing finished,
-- nothing closed, nothing archived.
--
-- This does NOT take away their record of what they worked and were paid.
-- That lives in Pay History (tech_my_payments), which lists every payout with
-- its work order number, title, site, amount and date — the thing Fred asked
-- for originally, "see what they worked on and what they were payed for".
-- What goes away is the pile of closed job cards on top of it.
--
-- Filtered in the database rather than hidden in the page, so a finished job
-- is not merely out of sight — it is never sent to the browser at all.

CREATE OR REPLACE FUNCTION public.tech_my_jobs()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ctx jsonb := tech_ctx(); v_name text; v_owner uuid; v_out jsonb;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;
  v_name  := v_ctx->>'contractor_name';
  v_owner := (v_ctx->>'owner_id')::uuid;

  SELECT jsonb_agg(j ORDER BY sort_date DESC NULLS LAST) INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'id', w.id, 'wo_number', w.wo_number, 'title', w.title, 'description', w.description,
      'scope_of_work', w.scope_of_work, 'service_type', w.service_type, 'wo_status', w.wo_status,
      'customer_name', w.customer_name, 'project_name', w.project_name,
      'site_name', w.site_name, 'site_address', w.site_address, 'site_city', w.site_city,
      'site_state', w.site_state, 'site_zip', w.site_zip,
      'start_date', w.start_date, 'end_date', w.end_date, 'scheduled_date', w.scheduled_date,
      'checked_in_at', COALESCE(ctl.checked_in_at, w.checked_in_at),
      'checked_out_at', COALESCE(ctl.checked_out_at, w.checked_out_at),
      -- ctl.hourly_rate is money and is deliberately NOT selected.
      'hours_worked', COALESCE(ctl.adjusted_hours, w.hours_worked),
      'closeout_notes', w.closeout_notes, 'archived_at', w.archived_at,
      -- Kept so the client code kept from before still reads sensibly. Every
      -- row returned here is live work, so both are always false.
      'is_closed', false,
      'is_active', true,
      'paid_total', 0,
      'last_paid_on', NULL,
      'created_at', w.created_at
    ) AS j,
    COALESCE(w.scheduled_date, w.start_date, w.created_at::date) AS sort_date
    FROM work_orders w
    LEFT JOIN contractor_time_logs ctl
      ON ctl.wo_id = w.id AND ctl.contractor_name = v_name
    WHERE w.user_id = v_owner
      AND (w.contractor_name = v_name
           OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
           OR w.lead_contractor_name = v_name)
      -- Live work only. Finished, closed, cancelled and archived all drop out.
      AND w.archived_at IS NULL
      AND w.wo_status NOT IN ('Work Done', 'Approved', 'Paid', 'Cancelled')
  ) sub;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tech_my_jobs() TO authenticated;
