-- Migration 091: site photos on crew sites.
--
-- Leads photograph each meetinghouse: the building, before, the rack, after,
-- and deliverables. Fred can add photos from the office too. Files live in the
-- private crew-photos bucket:
--   <contractor_id>/<site_id>/<random>.<ext>      uploaded by a lead
--   office/<owner uid>/<site_id>/<random>.<ext>   uploaded by Fred
-- A lead reads and writes only their own folder; Fred reads anything a photo
-- row of his names.

CREATE TABLE IF NOT EXISTS public.crew_site_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  site_id     uuid NOT NULL REFERENCES public.crew_sites(id) ON DELETE CASCADE,
  team_id     uuid REFERENCES public.crew_teams(id) ON DELETE SET NULL,
  kind        text NOT NULL DEFAULT 'site' CHECK (kind IN ('site','before','rack','after','deliverable','other')),
  file_path   text NOT NULL,
  caption     text,
  taken_by    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crew_site_photos_site_idx ON public.crew_site_photos (site_id, created_at);

ALTER TABLE public.crew_site_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crew_site_photos_owner ON public.crew_site_photos;
CREATE POLICY crew_site_photos_owner ON public.crew_site_photos FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.tech_crew_photos()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := tech_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', ph.id, 'site_id', ph.site_id, 'kind', ph.kind, 'file_path', ph.file_path,
             'caption', ph.caption, 'created_at', ph.created_at,
             'mine', split_part(ph.file_path, '/', 1) = (v_ctx ->> 'contractor_id')
           ) ORDER BY ph.created_at DESC)
    FROM crew_site_photos ph
    WHERE crew_tech_site_team(ph.site_id) IS NOT NULL
      AND split_part(ph.file_path, '/', 1) = (v_ctx ->> 'contractor_id')
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_crew_add_photo(p_site uuid, p_path text, p_kind text, p_caption text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx  jsonb := tech_ctx();
  v_team uuid;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  v_team := crew_tech_site_team(p_site);
  IF v_team IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_your_site'); END IF;
  IF p_path IS NULL OR split_part(p_path, '/', 1) <> (v_ctx ->> 'contractor_id') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_file');
  END IF;
  IF p_kind NOT IN ('site','before','rack','after','deliverable','other') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_category');
  END IF;
  INSERT INTO crew_site_photos (user_id, site_id, team_id, kind, file_path, caption, taken_by)
  VALUES ((v_ctx ->> 'owner_id')::uuid, p_site, v_team, p_kind, p_path,
          NULLIF(trim(p_caption), ''), v_ctx ->> 'contractor_name');
  RETURN jsonb_build_object('ok', true, 'reason', 'saved');
END;
$$;

CREATE OR REPLACE FUNCTION public.tech_crew_delete_photo(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_row record;
BEGIN
  SELECT * INTO v_row FROM crew_site_photos WHERE id = p_id;
  IF NOT FOUND OR v_ctx IS NULL
     OR split_part(v_row.file_path, '/', 1) <> (v_ctx ->> 'contractor_id') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  DELETE FROM crew_site_photos WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'reason', 'deleted', 'file_path', v_row.file_path);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tech_crew_photos(), public.tech_crew_add_photo(uuid, text, text, text),
                          public.tech_crew_delete_photo(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.tech_crew_photos(), public.tech_crew_add_photo(uuid, text, text, text),
                           public.tech_crew_delete_photo(uuid) FROM anon;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('crew-photos', 'crew-photos', false, 15728640,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS crew_photos_insert ON storage.objects;
CREATE POLICY crew_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crew-photos'
              AND ((storage.foldername(name))[1] = public.crew_tech_folder()
                   OR ((storage.foldername(name))[1] = 'office'
                       AND (storage.foldername(name))[2] = auth.uid()::text)));

DROP POLICY IF EXISTS crew_photos_delete ON storage.objects;
CREATE POLICY crew_photos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'crew-photos'
         AND ((storage.foldername(name))[1] = public.crew_tech_folder()
              OR EXISTS (SELECT 1 FROM public.crew_site_photos ph
                          WHERE ph.file_path = storage.objects.name AND ph.user_id = auth.uid())
              OR ((storage.foldername(name))[1] = 'office'
                  AND (storage.foldername(name))[2] = auth.uid()::text)));

DROP POLICY IF EXISTS crew_photos_read ON storage.objects;
CREATE POLICY crew_photos_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'crew-photos'
         AND ((storage.foldername(name))[1] = public.crew_tech_folder()
              OR EXISTS (SELECT 1 FROM public.crew_site_photos ph
                          WHERE ph.file_path = storage.objects.name AND ph.user_id = auth.uid())
              OR ((storage.foldername(name))[1] = 'office'
                  AND (storage.foldername(name))[2] = auth.uid()::text)));
