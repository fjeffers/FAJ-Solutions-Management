-- Migration 125: the office's job documents reach the tech app (2026-10-14).
--
-- Fred: "under the portal in FAJ i dont see the documents i just uploaded".
-- Files added on the office Edit job screen (Documents tab) are stored in the
-- deliverables bucket under wo-docs/ and listed in work_orders.doc_urls. The
-- emailed contractor portal always showed them as "Job Documents", but the
-- tech app only listed job_docs (migrations 115/116), so the install guides
-- and sign-off sheets Fred attached never appeared there.
--
--   wf_tech_job_files   the office files on the tech's own live job: name and
--                       link only. Same job check as wf_tech_job_docs. Tech
--                       photos also live in doc_urls, so only wo-docs/ files
--                       are returned.

CREATE OR REPLACE FUNCTION public.wf_tech_job_files(p_wo_number text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_wo uuid;
BEGIN
  IF tech_ctx() IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_wo := (wf_tech_photo_target(p_wo_number)->>'wo_id')::uuid;
  IF v_wo IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'url', u.url,
      'name', replace(regexp_replace(split_part(u.url, '/wo-docs/', 2), '^\d{13}-', ''), '_', ' ')
    ) ORDER BY u.ord)
    FROM work_orders w, unnest(COALESCE(w.doc_urls, ARRAY[]::text[])) WITH ORDINALITY AS u(url, ord)
    WHERE w.id = v_wo AND u.url LIKE '%/storage/v1/object/public/deliverables/wo-docs/%'
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_job_files(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_job_files(text) TO authenticated;
