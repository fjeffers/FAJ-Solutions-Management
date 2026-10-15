-- Migration 126: live updates between the office and the tech app (2026-10-14).
--
-- Fred: "implement live update between admin and tech portal".
--
--   wf_tech_files_stamp   how many office documents (wo-docs/, migration 125)
--                         each of the tech's live jobs has, so the tech app
--                         can tell when a new one was added without
--                         re-reading every file list.
--   supabase_realtime     the tables techs write to (receipts, documents,
--                         notes, photos, day events, clock taps) now stream to
--                         the office screens the same way work_orders already
--                         did (migration 028). Row security still decides who
--                         receives each change.

CREATE OR REPLACE FUNCTION public.wf_tech_files_stamp()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx(); v_name text;
BEGIN
  IF v_ctx IS NULL THEN RETURN '{}'::jsonb; END IF;
  v_name := v_ctx->>'contractor_name';
  RETURN COALESCE((
    SELECT jsonb_object_agg(w.wo_number, (
      SELECT count(*) FROM unnest(COALESCE(w.doc_urls, ARRAY[]::text[])) u
       WHERE u LIKE '%/storage/v1/object/public/deliverables/wo-docs/%'))
    FROM work_orders w
    WHERE w.user_id = (v_ctx->>'owner_id')::uuid AND w.archived_at IS NULL
      AND COALESCE(w.wo_status, 'Open') NOT IN ('Approved', 'Paid', 'Cancelled')
      AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
           OR w.lead_contractor_name = v_name)
  ), '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_files_stamp() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_files_stamp() TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_docs', 'job_notes', 'job_expenses', 'wo_photos', 'job_day_events', 'job_punches'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END;
$$;
