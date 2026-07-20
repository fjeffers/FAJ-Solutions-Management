-- Migration 037: Floor plan site survey — visual plan per floor + photo storage
--
-- Each network floor (network_sites) carries a floor_plan JSONB:
--   { rooms: [{id,name,x,y,w,h,kind}], items: [{id,type,x,y,label,drop_id,ports,notes,photos[]}] }
-- Drawn/edited in the app's Floor Plan tab; photos upload to the
-- network-photos bucket (public-read so plan pins can render them inline;
-- only authenticated users can write).

ALTER TABLE network_sites
  ADD COLUMN IF NOT EXISTS floor_plan JSONB NOT NULL DEFAULT '{"rooms":[],"items":[]}';

INSERT INTO storage.buckets (id, name, public)
  VALUES ('network-photos', 'network-photos', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated upload network photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'network-photos');

CREATE POLICY "Authenticated update network photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'network-photos');

CREATE POLICY "Authenticated delete network photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'network-photos');
