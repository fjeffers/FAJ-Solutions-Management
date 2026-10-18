-- Migration 130: the client's links on a work order (2026-10-18).
--
-- Fred, for the LDS jobs: "somewhere for me to put where the links and
-- everything like that that I got from the client is basically going to be
-- ... Everything else, the client already provide a link for that. I just want
-- to link that link into the work order."
--
--   work_orders.client_links   The links Fred pastes on the job (web addresses
--                              only, at most 10). Shown to the tech as buttons.
--   wf_tech_job_links()        The tech's own live job: its client links. Same
--                              job check as wf_tech_job_files (migration 125);
--                              a separate call, so wf_tech_jobs() is untouched.

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS client_links text[];
ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_client_links_shape;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_client_links_shape CHECK (
  client_links IS NULL OR (COALESCE(array_length(client_links, 1), 0) <= 10 AND pg_column_size(client_links) < 8192));

CREATE OR REPLACE FUNCTION public.wf_tech_job_links(p_wo_number text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_wo uuid;
BEGIN
  IF tech_ctx() IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_wo := (wf_tech_photo_target(p_wo_number)->>'wo_id')::uuid;
  IF v_wo IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(u.link ORDER BY u.ord)
    FROM work_orders w, unnest(COALESCE(w.client_links, ARRAY[]::text[])) WITH ORDINALITY AS u(link, ord)
    WHERE w.id = v_wo AND u.link ~* '^https?://'
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_job_links(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_job_links(text) TO authenticated;
