-- Migration 006: POC fields, custom Q&A, question templates

-- Add POC + support contact fields to work_orders
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS poc_name       text,
  ADD COLUMN IF NOT EXISTS poc_phone      text,
  ADD COLUMN IF NOT EXISTS poc_email      text,
  ADD COLUMN IF NOT EXISTS support_contact text,
  ADD COLUMN IF NOT EXISTS custom_qa      jsonb DEFAULT '[]';

-- Question templates table
CREATE TABLE IF NOT EXISTS question_templates (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  questions  jsonb       NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: admin owns their templates
ALTER TABLE question_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own question templates"
  ON question_templates FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
