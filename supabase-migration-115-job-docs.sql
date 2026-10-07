-- Migration 115: documents on a job, scanned by techs (2026-10-07).
--
-- Fred, sending the iScanner app: "all the above for my tech to use" — scan
-- paperwork to PDF (signed work orders, receipts, site sheets, permits).
-- A scan can hold anything (a signature, an ID, a tax form), so documents get
-- their own PRIVATE bucket, unlike job photos (portal-uploads, public links):
--
--   job_docs          one row per document: the job, a name, a kind, pages,
--                     who sent it. Owner-only RLS.
--   bucket job-docs   private. Files live at <owner uid>/<wo id>/<file>.pdf;
--                     the owner reads (signed links) only under their own uid.
--                     Techs never read it back — /api/tech/doc stores the file
--                     with the service role after the tech's own session proves
--                     the job is theirs (wf_tech_photo_target).
--   wf_tech_job_docs  what a tech has sent on their job: names and dates only.

CREATE TABLE IF NOT EXISTS public.job_docs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wo_id       uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  path        text NOT NULL UNIQUE,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'Document',
  pages       integer,
  bytes       integer,
  sent_by     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_docs_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT job_docs_kind_len CHECK (char_length(kind) <= 40)
);
CREATE INDEX IF NOT EXISTS job_docs_wo_idx ON public.job_docs (wo_id, created_at DESC);

ALTER TABLE public.job_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner manages job docs" ON public.job_docs;
CREATE POLICY "Owner manages job docs" ON public.job_docs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.job_docs FROM anon;

INSERT INTO storage.buckets (id, name, public) VALUES ('job-docs', 'job-docs', false)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS job_docs_owner_read ON storage.objects;
CREATE POLICY job_docs_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'job-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS job_docs_owner_delete ON storage.objects;
CREATE POLICY job_docs_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'job-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- A tech's own sent documents on one of their live jobs (names only, never a link).
CREATE OR REPLACE FUNCTION public.wf_tech_job_docs(p_wo_number text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx(); v_wo uuid;
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_wo := (wf_tech_photo_target(p_wo_number)->>'wo_id')::uuid;
  IF v_wo IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'kind', d.kind, 'pages', d.pages, 'created_at', d.created_at) ORDER BY d.created_at DESC)
    FROM job_docs d WHERE d.wo_id = v_wo AND d.sent_by = (v_ctx->>'contractor_name')
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_job_docs(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_job_docs(text) TO authenticated;
