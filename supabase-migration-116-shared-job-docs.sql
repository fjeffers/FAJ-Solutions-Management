-- Migration 116: PDFs to sign on the job (2026-10-07).
--
-- Fred: "go ahead with the edit and sign pdfs everything from iscanner".
-- Documents on a job (migration 115) can now go both ways:
--
--   job_docs.for_tech   the office ticks it on a document so the techs on that
--                       job can open it, fill it in and sign it. Off by default
--                       — an office document can carry prices.
--   storage insert      the office adds PDFs into its own folder of job-docs
--                       (until now only /api/tech/doc stored files there).
--   wf_tech_job_docs    lists the tech's own documents AND the ones shared
--                       with them (still names and dates only).
--   wf_tech_doc_path    where one of those is stored — only for the tech's own
--                       live job. /api/tech/doc reads the file with it; a tech
--                       never gets a link to the bucket.

ALTER TABLE public.job_docs ADD COLUMN IF NOT EXISTS for_tech boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS job_docs_owner_insert ON storage.objects;
CREATE POLICY job_docs_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE OR REPLACE FUNCTION public.wf_tech_job_docs(p_wo_number text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx(); v_wo uuid; v_name text;
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_name := v_ctx->>'contractor_name';
  v_wo := (wf_tech_photo_target(p_wo_number)->>'wo_id')::uuid;
  IF v_wo IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.name, 'kind', d.kind, 'pages', d.pages, 'created_at', d.created_at,
      'mine', COALESCE(d.sent_by = v_name, false), 'shared', d.for_tech
    ) ORDER BY d.for_tech DESC, d.created_at DESC)
    FROM job_docs d WHERE d.wo_id = v_wo AND (d.sent_by = v_name OR d.for_tech)
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_job_docs(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_job_docs(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wf_tech_doc_path(p_doc uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx(); v_path text;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;
  SELECT d.path INTO v_path
    FROM job_docs d JOIN work_orders w ON w.id = d.wo_id
   WHERE d.id = p_doc
     AND (d.for_tech OR d.sent_by = (v_ctx->>'contractor_name'))
     AND (wf_tech_photo_target(w.wo_number)->>'wo_id')::uuid = w.id;
  RETURN v_path;
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_doc_path(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_doc_path(uuid) TO authenticated;
