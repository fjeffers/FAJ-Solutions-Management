-- 080: a job a tech has finished belongs to the office, not to them.
--
-- migration-077 moved a "Work Done" job out of the tech's active list into
-- their history. Fred's correction: it should not be visible to them at all.
-- Once they say the work is done it is the office's to review, approve and
-- pay, and until that happens it is not the tech's business.
--
-- So the tech portal now shows exactly two things:
--
--   Active work   — still theirs to do
--   History       — closed and settled, with what THEY were paid
--
-- and nothing in between. A job sits invisible to them between "work done"
-- and the office closing it. Fred still sees it the whole time: it stays
-- unarchived on the admin side and shows on his dashboard as waiting on him.
--
-- Undoing a mistaken "work done" is now the office's job, which is the point —
-- a tech cannot quietly reopen work they have already handed over.

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
      'is_closed', (w.wo_status IN ('Approved','Paid') OR w.archived_at IS NOT NULL),
      'is_active', NOT (
        w.wo_status IN ('Approved','Paid','Work Done') OR w.archived_at IS NOT NULL
      ),
      -- Their own pay on this job, scoped to their own name.
      'paid_total',   COALESCE(pay.paid_total, 0),
      'last_paid_on', pay.last_paid_on,
      'created_at', w.created_at
    ) AS j,
    COALESCE(w.scheduled_date, w.start_date, w.created_at::date) AS sort_date
    FROM work_orders w
    LEFT JOIN contractor_time_logs ctl
      ON ctl.wo_id = w.id AND ctl.contractor_name = v_name
    LEFT JOIN LATERAL (
      SELECT SUM(p.amount)       AS paid_total,
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
      -- Handed back and not yet closed: the office's, not theirs. It reappears
      -- in their history the moment it is closed as Approved or Paid.
      AND NOT (w.wo_status = 'Work Done' AND w.archived_at IS NULL)
  ) sub;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tech_my_jobs() TO authenticated;
