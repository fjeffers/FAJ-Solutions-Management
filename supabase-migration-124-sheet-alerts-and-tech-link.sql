-- Migration 124: alerts on the sheet itself, and the tech app opens the sheet.
--
-- Fred, 2026-10-14: "I want the alert to be within that sheet, not getting an
-- email every time" ... "after a while the email chain will be too much" ...
-- "I want the tech app and the web URL to be linked".
--
-- Whoever has the sheet link can turn on phone alerts right on the sheet (no
-- login): this table keeps that phone's sign-up. Alerts go to it as phone
-- pop-ups that open the sheet. A sign-up belongs to the link it came through,
-- so "New link" stops every phone that had the old one.
-- Email now goes only when someone is stopped or late (app/api/alerts/dispatch).

CREATE TABLE IF NOT EXISTS public.sheet_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_name text NOT NULL,
  token text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz
);
CREATE INDEX IF NOT EXISTS sheet_push_subscriptions_project_idx ON public.sheet_push_subscriptions (user_id, project_name);
ALTER TABLE public.sheet_push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheet_push_subscriptions_owner_read ON public.sheet_push_subscriptions;
CREATE POLICY sheet_push_subscriptions_owner_read ON public.sheet_push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- The project sheet for one of the tech's own jobs: the same link the project
-- manager has, opened at that site.
CREATE OR REPLACE FUNCTION public.wf_tech_sheet_link(p_wo_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo work_orders%ROWTYPE; v_project text; v_token text;
BEGIN
  v_wo := wf_tech_own_job(p_wo_number);
  v_project := NULLIF(btrim(COALESCE(v_wo.project_name, '')), '');
  IF v_wo.id IS NULL OR NOT COALESCE(v_wo.is_project, false) OR v_project IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  INSERT INTO project_sheets (user_id, project_name) VALUES (v_wo.user_id, v_project) ON CONFLICT DO NOTHING;
  SELECT token INTO v_token FROM project_sheets WHERE user_id = v_wo.user_id AND project_name = v_project;
  RETURN jsonb_build_object('ok', v_token IS NOT NULL, 'token', v_token, 'site', v_wo.wo_number);
END $$;
REVOKE ALL ON FUNCTION public.wf_tech_sheet_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_sheet_link(text) TO authenticated;
