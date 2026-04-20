-- Migration 007: attachment_url for templates and work orders
ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE work_orders       ADD COLUMN IF NOT EXISTS attachment_url text;
