-- Migration 020: deliverable_templates table
-- Stores reusable deliverable checklists that can be applied to work orders.

CREATE TABLE IF NOT EXISTS deliverable_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  items       TEXT[]      NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE deliverable_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own deliverable templates"
  ON deliverable_templates FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
