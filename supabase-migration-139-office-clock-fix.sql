-- Migration 139: the office fixes a tech's clock (Field Sheet → Clock in and out).
--
-- Fred, 2026-10-24: "i cant edit hours on the app in case some one forget to
-- log in or the app was not working for them i need to be able to edit their
-- hours"; "i too close off as the admin"; "if i need to add or remove edit i
-- should be able too"; "i have some still saying on site when they are not".
--
-- A tech who never tapped Off site stays "on site" everywhere: their job card,
-- the crew list, the day log. The office can now clock them out, add a clock-in
-- or clock-out the app missed, move one to the right time, or remove one tapped
-- by mistake. Every change is kept in audit_log.
--
--   job_punches.by_office    the office added it (not the tech's phone)
--   job_punches.tapped_at    what the tech tapped, before the office moved it
--   job_punches.office_note  why (optional)
--   wf_owner_fix_punch()     add / move / remove a punch on the owner's own
--                            work order, then set the tech's card
--                            (contractor_time_logs) from the clock: on site from
--                            the last clock-in until a clock-out after it.
--
-- Owner only (is_business_owner), like wf_owner_remove_expense.

ALTER TABLE public.job_punches ADD COLUMN IF NOT EXISTS by_office boolean NOT NULL DEFAULT false;
ALTER TABLE public.job_punches ADD COLUMN IF NOT EXISTS tapped_at timestamptz;
ALTER TABLE public.job_punches ADD COLUMN IF NOT EXISTS office_note text;

CREATE OR REPLACE FUNCTION public.wf_owner_fix_punch(
  p_op text, p_wo_id uuid, p_tech text DEFAULT NULL, p_kind text DEFAULT NULL,
  p_at timestamptz DEFAULT NULL, p_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_wo work_orders%ROWTYPE;
  v_p job_punches%ROWTYPE;
  v_tech text;
  v_kind text;
  v_id uuid;
  v_in timestamptz;
  v_out timestamptz;
  v_note text := NULLIF(left(btrim(COALESCE(p_note, '')), 300), '');
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  SELECT * INTO v_wo FROM work_orders WHERE id = p_wo_id AND user_id = auth.uid();
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF p_op IN ('add', 'move') AND (p_at IS NULL OR p_at > now() + interval '1 day' OR p_at < now() - interval '400 days') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_time');
  END IF;

  IF p_op = 'add' THEN
    v_tech := btrim(COALESCE(p_tech, ''));
    IF v_tech = '' OR char_length(v_tech) > 120 THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_tech'); END IF;
    IF p_kind IS NULL OR p_kind NOT IN ('in', 'out') THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_kind'); END IF;
    v_kind := p_kind;
    INSERT INTO job_punches (user_id, wo_id, wo_number, contractor_name, kind, at, by_office, office_note)
    VALUES (auth.uid(), v_wo.id, v_wo.wo_number, v_tech, p_kind, p_at, true, v_note)
    RETURNING id INTO v_id;
  ELSIF p_op IN ('move', 'remove') THEN
    SELECT * INTO v_p FROM job_punches WHERE id = p_id AND wo_id = v_wo.id AND user_id = auth.uid();
    IF v_p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
    v_tech := v_p.contractor_name; v_kind := v_p.kind; v_id := v_p.id;
    IF p_op = 'move' THEN
      UPDATE job_punches
         SET at = p_at,
             tapped_at = COALESCE(tapped_at, CASE WHEN by_office THEN NULL ELSE at END),
             office_note = COALESCE(v_note, office_note)
       WHERE id = v_p.id;
    ELSE
      DELETE FROM job_punches WHERE id = v_p.id;
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_op');
  END IF;

  -- The tech's card follows the clock: on site from the last clock-in until a clock-out after it.
  SELECT max(at) FILTER (WHERE kind = 'in'), max(at) FILTER (WHERE kind = 'out') INTO v_in, v_out
    FROM job_punches WHERE wo_id = v_wo.id AND contractor_name = v_tech;
  UPDATE contractor_time_logs
     SET checked_in_at = v_in,
         checked_out_at = CASE WHEN v_out IS NOT NULL AND (v_in IS NULL OR v_out >= v_in) THEN v_out END,
         updated_at = now()
   WHERE wo_id = v_wo.id AND contractor_name = v_tech;
  IF NOT FOUND AND v_in IS NOT NULL THEN
    INSERT INTO contractor_time_logs (wo_id, wo_number, contractor_name, checked_in_at, checked_out_at)
    VALUES (v_wo.id, v_wo.wo_number, v_tech, v_in, CASE WHEN v_out >= v_in THEN v_out END);
  END IF;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), CASE p_op WHEN 'add' THEN 'create' WHEN 'move' THEN 'update' ELSE 'delete' END, 'job_punch', v_id,
    jsonb_build_object(
      'label', 'Office ' || CASE p_op WHEN 'add' THEN 'added' WHEN 'move' THEN 'moved' ELSE 'removed' END || ' '
        || v_tech || '''s clock-' || v_kind || ' on WO#' || v_wo.wo_number,
      'tech', v_tech, 'kind', v_kind, 'at', p_at, 'was', v_p.at, 'note', v_note));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.wf_owner_fix_punch(text, uuid, text, text, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_owner_fix_punch(text, uuid, text, text, timestamptz, uuid, text) TO authenticated;
