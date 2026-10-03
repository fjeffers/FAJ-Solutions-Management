-- Migration 104: the support ticket bot, and techs on hold.
--
-- Fred, 2026-10-03: email to support@fajsolutions.com becomes a ticket; the
-- bot suggests a queue and drafts a reply, and nothing moves until Fred
-- approves it, assigns a tech and saves the work order (which emails the tech
-- the usual assignment). "The new techs - put a hold on them for now."
--
-- support_tickets is the owner's alone (same rule as import_queue): techs and
-- the assistant never read it. suggested_queue is what the bot said;
-- final_queue is what Fred chose when he approved - the pair is the label set
-- the support-bot eval scores against.

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source            text NOT NULL DEFAULT 'email' CHECK (source IN ('email', 'pasted')),
  gmail_message_id  text,
  gmail_thread_id   text,
  from_name         text,
  from_email        text,
  subject           text,
  body              text NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),

  -- What the bot made of it (lib/support-triage.ts)
  suggested_queue   text CHECK (suggested_queue IN ('dispatch', 'field_issue', 'billing', 'new_work', 'needs_fred', 'not_a_ticket')),
  suggested_reason  text,
  summary           text,
  urgent            boolean NOT NULL DEFAULT false,
  client_name       text,
  site              text,
  wo_number         text,
  contact_name      text,
  contact_phone     text,
  job_title         text,
  draft_reply       text,
  triage_model      text,
  triage_usage      jsonb,
  triage_error      text,

  -- What Fred decided
  status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'approved', 'dismissed')),
  final_queue       text CHECK (final_queue IN ('dispatch', 'field_issue', 'billing', 'new_work', 'needs_fred', 'not_a_ticket')),
  assigned_tech     text,
  wo_id             uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS support_tickets_user_status ON public.support_tickets (user_id, status, received_at DESC);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own support tickets" ON public.support_tickets;
CREATE POLICY "Users manage own support tickets" ON public.support_tickets
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- A tech on hold can't be picked for a ticket or a job, and gets no
-- assignment email, until Fred releases them. Crew projects are unaffected.
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS on_hold boolean NOT NULL DEFAULT false;
