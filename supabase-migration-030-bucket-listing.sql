-- Migration 030: stop public listing of storage buckets
-- Supabase security lint 0025: public buckets serve individual files by URL
-- without any SELECT policy on storage.objects; these broad policies only
-- enabled anonymous LISTING of every file (deliverable photos, sign-offs,
-- portal uploads). The app never calls storage.list(), so nothing breaks.

DROP POLICY IF EXISTS "public_read_deliverables" ON storage.objects;
DROP POLICY IF EXISTS "portal public read" ON storage.objects;
