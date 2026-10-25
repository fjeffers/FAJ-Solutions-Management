-- Migration 142: the client's survey link and documents link (2026-10-25).
--
-- Fred: "in the customer links i need then to have a deliverable link like how
-- we have a check and out link and one for survey and one for documents".
-- Like migration 133, these only say which of the job's client links is which,
-- so the tech's button says what it's for.
--
--   work_orders.survey_link        where the tech fills in the site survey
--   work_orders.deliverable_link   where the tech uploads the photos and documents
--   wf_tech_site_links()           the tech's own live job: now all four links.
--                                  Same job check as before (migrations 130, 135).
--
-- The LDS jobs already carry both links: each gets them marked, the survey
-- form (survey.ldsqa.fyi) and the job's Google Drive folder.

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS survey_link text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS deliverable_link text;
ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_more_links_shape;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_more_links_shape CHECK (
  (survey_link IS NULL OR (survey_link ~* '^https?://' AND length(survey_link) <= 2000))
  AND (deliverable_link IS NULL OR (deliverable_link ~* '^https?://' AND length(deliverable_link) <= 2000)));

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
      'survey', w.survey_link, 'deliverable', w.deliverable_link,
      'site_id', NULLIF(trim(w.client_reference), ''), 'ticket', NULLIF(trim(w.external_wo_id), '')))
    FROM work_orders w WHERE w.id = v_wo
  ), '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_site_links(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_site_links(text) TO authenticated;

-- The LDS jobs: mark the links they already have.
UPDATE public.work_orders w SET
  survey_link = COALESCE(w.survey_link, (SELECT l FROM unnest(w.client_links) l WHERE l ~* '^https://survey\.ldsqa\.fyi' LIMIT 1)),
  deliverable_link = COALESCE(w.deliverable_link, (SELECT l FROM unnest(w.client_links) l WHERE l ~* '^https://drive\.google\.com/' LIMIT 1))
WHERE w.customer_name = 'LDS' AND w.client_links IS NOT NULL;
