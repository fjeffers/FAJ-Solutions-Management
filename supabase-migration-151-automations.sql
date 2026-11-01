-- Automations (Fred, 2026-10-31): which "when this happens, do that" rules are on,
-- and their number of days. Kept on Fred's settings row like his templates and fields.
-- Safe to run more than once.
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS automations jsonb NOT NULL DEFAULT '[]'::jsonb;
