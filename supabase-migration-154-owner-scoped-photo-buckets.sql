-- Migration 154: survey-docs and network-photos writes belong to the uploader
--
-- Migrations 037 and 068 let any signed-in login upload, replace or delete any
-- file in these two public buckets; they only checked the bucket name. A
-- self-made login could therefore swap or remove the floor plan photos and
-- survey documents shown on client quote pages. 068 also added a SELECT policy
-- for every role, which let anyone list the whole survey-docs bucket.
--
-- Now:
--   * uploads go under the uploader's user id: <auth.uid()>/<folder>/<file>
--     (lib/survey-upload.ts, components/FloorPlanView.tsx), and only office
--     logins (wf_role owner or staff) may upload;
--   * replace and delete are allowed only inside your own folder, or on a file
--     you uploaded before this migration (storage sets owner_id on upload);
--   * no SELECT policy: both buckets stay public, so files still load by their
--     URL on the quote page, but nobody can list them (same as migration 030).

DROP POLICY IF EXISTS "Public read survey docs" ON storage.objects;

DROP POLICY IF EXISTS "Authenticated upload survey docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update survey docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete survey docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload network photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update network photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete network photos" ON storage.objects;

DROP POLICY IF EXISTS "Office upload own survey docs" ON storage.objects;
CREATE POLICY "Office upload own survey docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'survey-docs'
              AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
              AND (SELECT public.wf_role() ->> 'role') IN ('owner', 'staff'));

DROP POLICY IF EXISTS "Owner update own survey docs" ON storage.objects;
CREATE POLICY "Owner update own survey docs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'survey-docs'
         AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
              OR owner_id = (SELECT auth.uid())::text))
  WITH CHECK (bucket_id = 'survey-docs'
              AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Owner delete own survey docs" ON storage.objects;
CREATE POLICY "Owner delete own survey docs"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'survey-docs'
         AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
              OR owner_id = (SELECT auth.uid())::text));

DROP POLICY IF EXISTS "Office upload own network photos" ON storage.objects;
CREATE POLICY "Office upload own network photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'network-photos'
              AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
              AND (SELECT public.wf_role() ->> 'role') IN ('owner', 'staff'));

DROP POLICY IF EXISTS "Owner update own network photos" ON storage.objects;
CREATE POLICY "Owner update own network photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'network-photos'
         AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
              OR owner_id = (SELECT auth.uid())::text))
  WITH CHECK (bucket_id = 'network-photos'
              AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Owner delete own network photos" ON storage.objects;
CREATE POLICY "Owner delete own network photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'network-photos'
         AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
              OR owner_id = (SELECT auth.uid())::text));
