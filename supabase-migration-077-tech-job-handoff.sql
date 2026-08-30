-- 077: a finished job leaves the tech and comes back to the office.
--
-- Before this, a job only left the tech's active list once Fred marked it
-- Approved or Paid. A tech who pressed "Work done" watched the job sit in
-- Active work with Start/Stop buttons still on it — which reads as "that
-- didn't save". The handoff was real in the database and invisible on screen.
--
-- 'Work Done' now ends the tech's active list. The job moves to History, and
-- History carries the one thing a tech actually needs from a finished job:
-- what they were paid and when. That is their OWN pay, from the payments
-- table under their own name — never the job's price and never the spread.
--
-- Nothing here changes what the office can do: a closed work order is still
-- fully editable, payable and restorable from the admin side.

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
      -- This tech's own logged hours, falling back to the job's. ctl.hourly_rate
      -- is money and is deliberately NOT selected.
      'hours_worked', COALESCE(ctl.adjusted_hours, w.hours_worked),
      'closeout_notes', w.closeout_notes, 'archived_at', w.archived_at,
      'is_closed', (w.wo_status IN ('Approved','Paid') OR w.archived_at IS NOT NULL),
      -- Still the tech's to work. Saying "work done" hands it back to the
      -- office, so it stops being active the moment they say so — they do not
      -- have to wait for Fred to close it before their list goes quiet.
      'is_active', NOT (
        w.wo_status IN ('Approved','Paid','Work Done') OR w.archived_at IS NOT NULL
      ),
      -- Their own pay on this job. Scoped to their name, so one tech's
      -- payout never appears on a job they shared with someone else.
      'paid_total',   COALESCE(pay.paid_total, 0),
      'last_paid_on', pay.last_paid_on,
      'created_at', w.created_at
    ) AS j,
    COALESCE(w.scheduled_date, w.start_date, w.created_at::date) AS sort_date
    FROM work_orders w
    LEFT JOIN contractor_time_logs ctl
      ON ctl.wo_id = w.id AND ctl.contractor_name = v_name
    LEFT JOIN LATERAL (
      SELECT SUM(p.amount)      AS paid_total,
             MAX(p.payment_date) AS last_paid_on
      FROM payments p
      WHERE p.user_id         = v_owner
        AND p.wo_number       = w.wo_number
        AND p.contractor_name = v_name
    ) pay ON TRUE
    WHERE w.user_id = v_owner
      AND (w.contractor_name = v_name
           OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
           OR w.lead_contractor_name = v_name)
  ) sub;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tech_my_jobs() TO authenticated;
