-- Migration 119: live alerts on projects.
--
-- Fred, 2026-10-13: "would I be able to get live access ... they log in ... get
-- a notification ASAP, pictures uploaded I receive it, or the PM". Answers:
-- phone pop-ups, email and text; him, the project manager, his assistant and
-- whoever else is on that project's list ("it can change according to the
-- project"); clock in / sign out, travel, start job / off site / site
-- finished, photos, notes, answers and receipts. "This will just be for the
-- project."
--
--   project_alert_people   who gets a project's alerts, and how (email,
--                          phone pop-up, text). Keyed by project_name. With
--                          nobody listed, the owner gets them.
--   project_alerts         the outbox: one row per thing that happened on a
--                          project job. Photos, notes and answers wait a
--                          minute or two and merge, so a burst of photos is
--                          one alert.
--   push_subscriptions     phones/computers that turned on pop-ups (office
--                          logins). Each login manages its own rows.
--   app_secrets            server-only settings: the alert sender's address
--                          and the pop-up (VAPID) keys, which the app makes
--                          itself the first time. No policies: service role only.
--   triggers               on job_day_events, job_punches, wo_photos,
--                          job_expenses and work_orders — project jobs only,
--                          tech actions only. A failure here never blocks the
--                          tech's tap (each is wrapped and only warns).
--   project_alerts_kick()  asks the app to send what's due (pg_net), right
--                          away on a new alert and every minute (pg_cron).

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_alert_people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  project_name  text NOT NULL CHECK (length(btrim(project_name)) > 0),
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  role          text NOT NULL DEFAULT 'other' CHECK (role IN ('owner', 'assistant', 'pm', 'other')),
  email         text,
  phone         text,
  auth_user_id  uuid,
  by_email      boolean NOT NULL DEFAULT true,
  by_push       boolean NOT NULL DEFAULT true,
  by_text       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_alert_people_idx ON public.project_alert_people (user_id, project_name);
ALTER TABLE public.project_alert_people ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_alert_people_owner ON public.project_alert_people;
CREATE POLICY project_alert_people_owner ON public.project_alert_people FOR ALL TO authenticated
  USING (user_id = auth.uid() AND is_business_owner(auth.uid())) WITH CHECK (user_id = auth.uid() AND is_business_owner(auth.uid()));
REVOKE ALL ON public.project_alert_people FROM anon;

CREATE TABLE IF NOT EXISTS public.project_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  wo_id         uuid REFERENCES public.work_orders(id) ON DELETE CASCADE,
  wo_number     text NOT NULL,
  project_name  text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('day_start', 'travel_start', 'travel_end', 'sign_out', 'start_job', 'off_site',
                                              'site_finished', 'photos', 'receipt', 'notes', 'answers', 'test')),
  tech          text,
  at            timestamptz NOT NULL DEFAULT now(),
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  send_after    timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  claimed_at    timestamptz,
  sent_at       timestamptz,
  result        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_alerts_due_idx ON public.project_alerts (status, send_after);
CREATE INDEX IF NOT EXISTS project_alerts_wo_idx ON public.project_alerts (wo_id, kind, status);
ALTER TABLE public.project_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_alerts_owner_read ON public.project_alerts;
CREATE POLICY project_alerts_owner_read ON public.project_alerts FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.project_alerts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.project_alerts FROM authenticated;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_ok_at    timestamptz
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subscriptions_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own ON public.push_subscriptions FOR ALL TO authenticated
  USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid());
REVOKE ALL ON public.push_subscriptions FROM anon;

CREATE TABLE IF NOT EXISTS public.app_secrets (
  name        text PRIMARY KEY,
  value       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_secrets FROM anon, authenticated;

-- ── Adding to the outbox ────────────────────────────────────────────────────

/** One alert for a project job (anything else is ignored). p_merge: fold into a waiting one of the same kind. */
CREATE OR REPLACE FUNCTION public.project_alert_add(
  p_wo uuid, p_kind text, p_tech text, p_at timestamptz, p_detail jsonb, p_delay interval DEFAULT '0', p_merge boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_wo   work_orders%ROWTYPE;
  v_id   uuid;
  v_d    jsonb;
BEGIN
  SELECT * INTO v_wo FROM work_orders WHERE id = p_wo;
  IF v_wo.id IS NULL OR NOT COALESCE(v_wo.is_project, false) THEN RETURN; END IF;

  IF p_merge THEN
    SELECT id, detail INTO v_id, v_d FROM project_alerts
     WHERE wo_id = p_wo AND kind = p_kind AND status = 'pending' AND COALESCE(tech, '') = COALESCE(p_tech, '')
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF v_id IS NOT NULL THEN
      UPDATE project_alerts
         SET detail = CASE p_kind
               WHEN 'photos' THEN jsonb_build_object(
                 'count', COALESCE((v_d ->> 'count')::int, 0) + 1,
                 'urls', CASE WHEN jsonb_array_length(COALESCE(v_d -> 'urls', '[]'::jsonb)) < 12
                              THEN COALESCE(v_d -> 'urls', '[]'::jsonb) || COALESCE(p_detail -> 'urls', '[]'::jsonb)
                              ELSE v_d -> 'urls' END)
               ELSE COALESCE(p_detail, '{}'::jsonb) END,
             at = COALESCE(p_at, now()),
             send_after = now() + p_delay
       WHERE id = v_id;
      RETURN;
    END IF;
  END IF;

  INSERT INTO project_alerts (user_id, wo_id, wo_number, project_name, kind, tech, at, detail, send_after)
  VALUES (v_wo.user_id, v_wo.id, v_wo.wo_number, COALESCE(NULLIF(btrim(v_wo.project_name), ''), 'Project'),
          p_kind, p_tech, COALESCE(p_at, now()), COALESCE(p_detail, '{}'::jsonb), now() + p_delay);
EXCEPTION WHEN others THEN
  RAISE WARNING 'project alert skipped: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.project_alert_add(uuid, text, text, timestamptz, jsonb, interval, boolean) FROM PUBLIC, anon, authenticated;

-- ── What happened: the triggers ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.project_alert_on_day_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_dest text;
BEGIN
  BEGIN
    IF NEW.kind = 'day_start' THEN
      PERFORM project_alert_add(NEW.wo_id, 'day_start', NEW.contractor_name, NEW.at, '{}'::jsonb);
    ELSIF NEW.kind = 'travel_start' THEN
      PERFORM project_alert_add(NEW.wo_id, 'travel_start', NEW.contractor_name, NEW.at,
        jsonb_build_object('dest', NEW.dest, 'origin', NEW.origin));
    ELSIF NEW.kind = 'travel_end' THEN
      SELECT dest INTO v_dest FROM job_day_events
       WHERE wo_id = NEW.wo_id AND contractor_name = NEW.contractor_name AND kind = 'travel_start' AND at <= NEW.at
       ORDER BY at DESC LIMIT 1;
      PERFORM project_alert_add(NEW.wo_id, CASE WHEN v_dest IN ('hotel', 'home') THEN 'sign_out' ELSE 'travel_end' END,
        NEW.contractor_name, NEW.at, jsonb_build_object('dest', COALESCE(v_dest, 'site'), 'miles', NEW.miles));
    END IF;
  EXCEPTION WHEN others THEN RAISE WARNING 'project alert skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_alert_day_event ON public.job_day_events;
CREATE TRIGGER project_alert_day_event AFTER INSERT ON public.job_day_events
  FOR EACH ROW EXECUTE FUNCTION public.project_alert_on_day_event();

CREATE OR REPLACE FUNCTION public.project_alert_on_punch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    IF NEW.kind = 'in' THEN
      PERFORM project_alert_add(NEW.wo_id, 'start_job', NEW.contractor_name, NEW.at, '{}'::jsonb);
    ELSIF NEW.kind = 'out' THEN
      -- A short wait: when it's "Site finished", that alert replaces this one.
      PERFORM project_alert_add(NEW.wo_id, 'off_site', NEW.contractor_name, NEW.at, '{}'::jsonb, interval '30 seconds');
    END IF;
  EXCEPTION WHEN others THEN RAISE WARNING 'project alert skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_alert_punch ON public.job_punches;
CREATE TRIGGER project_alert_punch AFTER INSERT ON public.job_punches
  FOR EACH ROW EXECUTE FUNCTION public.project_alert_on_punch();

CREATE OR REPLACE FUNCTION public.project_alert_on_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    IF COALESCE(NEW.contractor_name, '') NOT LIKE 'Office%' THEN
      PERFORM project_alert_add(NEW.wo_id, 'photos', NEW.contractor_name, NEW.taken_at,
        jsonb_build_object('count', 1, 'urls', jsonb_build_array(NEW.url)), interval '90 seconds', true);
    END IF;
  EXCEPTION WHEN others THEN RAISE WARNING 'project alert skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_alert_photo ON public.wo_photos;
CREATE TRIGGER project_alert_photo AFTER INSERT ON public.wo_photos
  FOR EACH ROW EXECUTE FUNCTION public.project_alert_on_photo();

CREATE OR REPLACE FUNCTION public.project_alert_on_expense()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    IF COALESCE(NEW.paid_by, 'tech') = 'tech' THEN
      PERFORM project_alert_add(NEW.wo_id, 'receipt', NEW.contractor_name, now(),
        jsonb_build_object('category', NEW.category, 'amount', NEW.amount, 'vendor', NEW.vendor, 'date', NEW.expense_date));
    END IF;
  EXCEPTION WHEN others THEN RAISE WARNING 'project alert skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_alert_expense ON public.job_expenses;
CREATE TRIGGER project_alert_expense AFTER INSERT ON public.job_expenses
  FOR EACH ROW EXECUTE FUNCTION public.project_alert_on_expense();

-- Site finished, notes and answers — only when a tech made the change.
CREATE OR REPLACE FUNCTION public.project_alert_on_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_tech text;
BEGIN
  BEGIN
    IF NOT COALESCE(NEW.is_project, false) OR auth.uid() IS NULL OR auth.uid() = NEW.user_id THEN RETURN NEW; END IF;
    SELECT name INTO v_tech FROM contractors WHERE auth_user_id = auth.uid() LIMIT 1;
    IF v_tech IS NULL THEN RETURN NEW; END IF;

    IF NEW.wo_status = 'Work Done' AND OLD.wo_status IS DISTINCT FROM 'Work Done' THEN
      UPDATE project_alerts SET status = 'skipped', result = jsonb_build_object('why', 'site finished')
       WHERE wo_id = NEW.id AND kind = 'off_site' AND status = 'pending';
      PERFORM project_alert_add(NEW.id, 'site_finished', v_tech, now(), jsonb_build_object(
        'skipped', COALESCE(NEW.closeout -> 'skipped', '{}'::jsonb),
        'sign_skip', NEW.closeout -> 'sign_skip',
        'signed_by', NEW.closeout -> 'signoff' ->> 'name',
        'done', jsonb_array_length(COALESCE(NEW.closeout -> 'done', '[]'::jsonb))));
    END IF;
    IF NEW.closeout_notes IS DISTINCT FROM OLD.closeout_notes AND btrim(COALESCE(NEW.closeout_notes, '')) <> '' THEN
      PERFORM project_alert_add(NEW.id, 'notes', v_tech, now(),
        jsonb_build_object('notes', left(NEW.closeout_notes, 2000)), interval '2 minutes', true);
    END IF;
    IF NEW.custom_qa IS DISTINCT FROM OLD.custom_qa THEN
      PERFORM project_alert_add(NEW.id, 'answers', v_tech, now(), jsonb_build_object(
        'answers', COALESCE((SELECT jsonb_agg(jsonb_build_object('q', q ->> 'label', 'a', q ->> 'answer'))
                               FROM jsonb_array_elements(COALESCE(NEW.custom_qa, '[]'::jsonb)) q
                              WHERE btrim(COALESCE(q ->> 'answer', '')) <> ''), '[]'::jsonb)),
        interval '2 minutes', true);
    END IF;
  EXCEPTION WHEN others THEN RAISE WARNING 'project alert skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_alert_job ON public.work_orders;
CREATE TRIGGER project_alert_job AFTER UPDATE OF wo_status, closeout_notes, custom_qa ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.project_alert_on_job();

-- ── Sending ─────────────────────────────────────────────────────────────────

/** Ask the app to send what's due (it reads the outbox itself; the call carries nothing). */
CREATE OR REPLACE FUNCTION public.project_alerts_kick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_url text;
BEGIN
  SELECT value INTO v_url FROM app_secrets WHERE name = 'alerts_dispatch_url';
  IF v_url IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM project_alerts
                  WHERE (status = 'pending' AND send_after <= now())
                     OR (status = 'sending' AND claimed_at < now() - interval '5 minutes')) THEN
    RETURN;
  END IF;
  PERFORM net.http_post(url := v_url, body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 10000);
EXCEPTION WHEN others THEN
  RAISE WARNING 'alert send request failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.project_alerts_kick() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.project_alert_on_new()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'pending' AND NEW.send_after <= now() THEN PERFORM project_alerts_kick(); END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_alert_new ON public.project_alerts;
CREATE TRIGGER project_alert_new AFTER INSERT ON public.project_alerts
  FOR EACH ROW EXECUTE FUNCTION public.project_alert_on_new();

/** The sender takes a batch to send (two senders never take the same alert). Service role only. */
CREATE OR REPLACE FUNCTION public.project_alerts_claim(p_limit int DEFAULT 25)
RETURNS SETOF public.project_alerts LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE project_alerts a SET status = 'sending', claimed_at = now()
   WHERE a.id IN (
     SELECT id FROM project_alerts
      WHERE (status = 'pending' AND send_after <= now())
         OR (status = 'sending' AND claimed_at < now() - interval '5 minutes')
      ORDER BY created_at LIMIT p_limit
      FOR UPDATE SKIP LOCKED)
  RETURNING a.*;
$$;
REVOKE ALL ON FUNCTION public.project_alerts_claim(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_alerts_claim(int) TO service_role;

-- Every minute: send anything that was waiting (photos, notes) or missed.
SELECT cron.schedule('project-alerts', '* * * * *', 'select public.project_alerts_kick()');

-- Live database only (not the practice copy, so practice never calls the live
-- app): where the app's sender lives.
--   INSERT INTO public.app_secrets (name, value)
--   VALUES ('alerts_dispatch_url', 'https://app.fajsolutions.com/api/alerts/dispatch')
--   ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
