-- Migration 135: the client's site and ticket numbers for the checkout form (2026-10-18).
--
-- The LDS checkout form asks for the Site ID and the Work Order # (NetView's
-- ticket). The app filled the Site ID from the job's title, which missed
-- titles like "LDS Site 5011876 — Gaffney", and put FAJ's own WO number in
-- NetView's ticket box. The job keeps both of the client's numbers
-- (client_reference, external_wo_id); the tech's phone now gets them with the
-- two links. Neither is money. Same job check as migration 133.

CREATE OR REPLACE FUNCTION public.wf_tech_site_links(p_wo_number text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_wo uuid;
BEGIN
  IF tech_ctx() IS NULL THEN RETURN '{}'::jsonb; END IF;
  v_wo := (wf_tech_photo_target(p_wo_number)->>'wo_id')::uuid;
  IF v_wo IS NULL THEN RETURN '{}'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_strip_nulls(jsonb_build_object(
      'checkin', w.checkin_link, 'checkout', w.checkout_link,
      'site_id', NULLIF(trim(w.client_reference), ''), 'ticket', NULLIF(trim(w.external_wo_id), '')))
    FROM work_orders w WHERE w.id = v_wo
  ), '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_site_links(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_site_links(text) TO authenticated;
