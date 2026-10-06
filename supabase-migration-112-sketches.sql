-- Migration 112: site sketches (Fred, 2026-10-06: "I want to be able to
-- sketch my own layout", modelled on magicplan and sketch.io's sketchpad).
--
--   sketches   one drawing: a floor plan to scale in feet (rooms, walls, cable
--              runs, symbols, photo pins) and free drawing. `data` is the
--              drawing (lib/sketch.ts checks it on every load); image_path is a
--              PNG of it for reports and quotes. Optionally on a job and/or a
--              survey; a sketch can also stand on its own.
--   storage    private bucket 'sketches', one folder per owner:
--              <owner id>/<sketch id>.png, <owner id>/photos/…, <owner id>/bg/…
--
-- Office only: owner RLS like everything else; nothing here is exposed to the
-- tech portal.

CREATE TABLE IF NOT EXISTS public.sketches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wo_id       uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  survey_id   uuid REFERENCES public.surveys(id) ON DELETE SET NULL,
  title       text NOT NULL DEFAULT 'Sketch',
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_path  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sketches_data_size CHECK (pg_column_size(data) < 3000000),
  CONSTRAINT sketches_title_len CHECK (char_length(title) <= 120)
);
CREATE INDEX IF NOT EXISTS sketches_wo_idx ON public.sketches (wo_id);
CREATE INDEX IF NOT EXISTS sketches_survey_idx ON public.sketches (survey_id);
CREATE INDEX IF NOT EXISTS sketches_owner_idx ON public.sketches (user_id, updated_at DESC);

ALTER TABLE public.sketches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner manages sketches" ON public.sketches;
CREATE POLICY "Owner manages sketches" ON public.sketches FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.sketches FROM anon;

INSERT INTO storage.buckets (id, name, public) VALUES ('sketches', 'sketches', false)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS sketches_owner_read ON storage.objects;
CREATE POLICY sketches_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sketches' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS sketches_owner_insert ON storage.objects;
CREATE POLICY sketches_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sketches' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS sketches_owner_update ON storage.objects;
CREATE POLICY sketches_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'sketches' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS sketches_owner_delete ON storage.objects;
CREATE POLICY sketches_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sketches' AND (storage.foldername(name))[1] = auth.uid()::text);
