-- =============================================================================
-- Migration 138: the office corrects a tech's tap time, and the first time stays
-- =============================================================================
-- Fred, 2026-10-24: "I need to pull the info from their work order and get it
-- in accurate times ... when they finish working I need to pull their hours and
-- send it to the client". A tech who forgot to tap Off site until they got home
-- puts hours on the client's bill that weren't worked. The office could correct
-- the miles on a drive (migration 117) but not a time.
--
--   job_day_events / job_punches  + original_at (the time the phone recorded,
--                                    kept on the first correction), edited_at,
--                                    edit_note
--   wf_owner_fix_time()            the business owner moves one tap on their own
--                                    job: no more than 2 days from what the phone
--                                    recorded, never into the future. Logged in
--                                    audit_log.
--
-- Pay is not touched: pay has its own adjusted hours (contractor_time_logs).
-- Alerts fire on new taps only (AFTER INSERT), so a correction sends nothing.
-- Safe to re-run.

ALTER TABLE public.job_day_events ADD COLUMN IF NOT EXISTS original_at timestamptz;
ALTER TABLE public.job_day_events ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.job_day_events ADD COLUMN IF NOT EXISTS edit_note text;
ALTER TABLE public.job_punches ADD COLUMN IF NOT EXISTS original_at timestamptz;
ALTER TABLE public.job_punches ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.job_punches ADD COLUMN IF NOT EXISTS edit_note text;

CREATE OR REPLACE FUNCTION public.wf_owner_fix_time(p_source text, p_id uuid, p_at timestamptz, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_at timestamptz; v_orig timestamptz; v_wo text; v_tech text; v_kind text;
  v_note text := NULLIF(left(btrim(COALESCE(p_note, '')), 300), '');
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  IF p_at IS NULL OR p_at > now() + interval '5 minutes' THEN RETURN jsonb_build_object('ok', false, 'reason', 'future'); END IF;

  IF p_source = 'day' THEN
    SELECT at, COALESCE(original_at, at), wo_number, contractor_name, kind INTO v_at, v_orig, v_wo, v_tech, v_kind
      FROM job_day_events WHERE id = p_id AND user_id = auth.uid();
  ELSIF p_source = 'punch' THEN
    SELECT at, COALESCE(original_at, at), wo_number, contractor_name, kind INTO v_at, v_orig, v_wo, v_tech, v_kind
      FROM job_punches WHERE id = p_id AND user_id = auth.uid();
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_source');
  END IF;
  IF v_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF abs(extract(epoch FROM (p_at - v_orig))) > 2 * 86400 THEN RETURN jsonb_build_object('ok', false, 'reason', 'too_far'); END IF;

  IF p_source = 'day' THEN
    UPDATE job_day_events SET at = p_at, original_at = v_orig, edited_at = now(), edit_note = v_note WHERE id = p_id;
  ELSE
    UPDATE job_punches SET at = p_at, original_at = v_orig, edited_at = now(), edit_note = v_note WHERE id = p_id;
  END IF;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'update', CASE WHEN p_source = 'day' THEN 'job_day_event' ELSE 'job_punch' END, p_id, jsonb_build_object(
    'label', 'Office changed ' || COALESCE(v_tech, 'a tech') || '''s ' || replace(v_kind, '_', ' ') || ' on WO#' || COALESCE(v_wo, '?')
      || ' from ' || to_char(v_at AT TIME ZONE 'America/New_York', 'Mon DD HH12:MI AM')
      || ' to ' || to_char(p_at AT TIME ZONE 'America/New_York', 'Mon DD HH12:MI AM'),
    'from', v_at, 'to', p_at, 'phone_time', v_orig, 'note', v_note));
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_owner_fix_time(text, uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_owner_fix_time(text, uuid, timestamptz, text) TO authenticated;
