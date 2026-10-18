-- Migration 133: the client link opened on site, and the one opened at check-out (2026-10-18).
--
-- Fred, for the LDS jobs: techs must be on the client's Teams meeting all day
-- on site, and check out every day on the client's own checkout form. "The
-- minute they check in, it goes directly to the Teams meeting ... and when
-- they're checking out for the day, this is what they need to do." The app
-- keeps its own on-site and off-site times either way; these only say which
-- of the job's links to open at those two moments.
--
--   work_orders.checkin_link    opened when the tech is on site and starts work
--   work_orders.checkout_link   opened when the tech goes off site for the day
--   wf_tech_site_links()        the tech's own live job: both links. Same job
--                               check as wf_tech_job_links (migration 130).

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS checkin_link text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS checkout_link text;
ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_site_links_shape;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_site_links_shape CHECK (
  (checkin_link IS NULL OR (checkin_link ~* '^https?://' AND length(checkin_link) <= 2000))
  AND (checkout_link IS NULL OR (checkout_link ~* '^https?://' AND length(checkout_link) <= 2000)));

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
    SELECT jsonb_strip_nulls(jsonb_build_object('checkin', w.checkin_link, 'checkout', w.checkout_link))
    FROM work_orders w WHERE w.id = v_wo
  ), '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_site_links(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_site_links(text) TO authenticated;
