-- Migration 154: a tech photo's link is built by the database, never taken
-- from the caller.
--
-- wf_tech_add_photo used to store whatever p_url the caller sent as long as
-- it ended with p_path, so a signed-in tech calling it directly could make a
-- job photo (and the job's doc_urls) point at an outside website. Now the
-- link is always this project's public portal-uploads link for p_path, and
-- the file must really be in that bucket. p_url stays in the signature so
-- /api/tech/photo keeps working; it is ignored.
--
-- Also repairs any tech photo already saved with a different link.
-- Safe to run more than once, after migration 153.

CREATE OR REPLACE FUNCTION public.wf_tech_add_photo(p_wo_number text, p_path text, p_url text, p_taken_at timestamptz,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_source text, p_label text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_target jsonb := wf_tech_photo_target(p_wo_number);
  v_wo uuid;
  v_url text;
  v_pos boolean := p_lat IS NOT NULL AND p_lng IS NOT NULL
                   AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180;
BEGIN
  IF v_target IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;
  v_wo := (v_target ->> 'wo_id')::uuid;
  IF p_path IS NULL OR p_path !~ ('^wo_' || v_wo::text || '/tech_[0-9a-z_-]+\.jpg$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'portal-uploads' AND o.name = p_path) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_file');
  END IF;
  v_url := 'https://izrjdhuosxtqteftzkhd.supabase.co/storage/v1/object/public/portal-uploads/' || p_path;

  INSERT INTO wo_photos (user_id, wo_id, wo_number, contractor_name, path, url, taken_at, lat, lng, accuracy, source, label)
  VALUES ((v_ctx ->> 'owner_id')::uuid, v_wo, p_wo_number, v_ctx ->> 'contractor_name', p_path, v_url,
          wf_trusted_time(p_taken_at),
          CASE WHEN v_pos THEN p_lat END, CASE WHEN v_pos THEN p_lng END,
          CASE WHEN v_pos AND p_accuracy >= 0 THEN p_accuracy END,
          CASE WHEN p_source = 'library' THEN 'library' ELSE 'camera' END,
          NULLIF(left(btrim(coalesce(p_label, '')), 80), ''));

  UPDATE work_orders
     SET doc_urls = array_append(COALESCE(doc_urls, ARRAY[]::text[]), v_url), updated_at = now()
   WHERE id = v_wo AND NOT (v_url = ANY(COALESCE(doc_urls, ARRAY[]::text[])));
  RETURN jsonb_build_object('ok', true, 'url', v_url);
END;
$function$;
REVOKE ALL ON FUNCTION public.wf_tech_add_photo(text, text, text, timestamptz, double precision, double precision, double precision, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_add_photo(text, text, text, timestamptz, double precision, double precision, double precision, text, text) TO authenticated, service_role;

-- Repair: any tech photo whose saved link isn't its own portal-uploads link
-- gets the right one, on the photo and in the job's file list.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.id, p.wo_id, p.url AS old_url,
           'https://izrjdhuosxtqteftzkhd.supabase.co/storage/v1/object/public/portal-uploads/' || p.path AS new_url
      FROM wo_photos p
     WHERE p.path ~ '^wo_[0-9a-f-]+/tech_[0-9a-z_-]+\.jpg$'
       AND p.url IS DISTINCT FROM 'https://izrjdhuosxtqteftzkhd.supabase.co/storage/v1/object/public/portal-uploads/' || p.path
  LOOP
    UPDATE wo_photos SET url = r.new_url WHERE id = r.id;
    IF r.old_url IS NOT NULL THEN
      UPDATE work_orders
         SET doc_urls = CASE WHEN r.new_url = ANY(COALESCE(doc_urls, ARRAY[]::text[]))
                             THEN array_remove(doc_urls, r.old_url)
                             ELSE array_replace(doc_urls, r.old_url, r.new_url) END,
             updated_at = now()
       WHERE id = r.wo_id AND r.old_url = ANY(COALESCE(doc_urls, ARRAY[]::text[]));
    END IF;
  END LOOP;
END;
$$;
