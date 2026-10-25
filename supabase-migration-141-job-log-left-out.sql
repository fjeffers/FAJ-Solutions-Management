-- Migration 141: pictures left out of a job's Job log (2026-10-25).
--
-- Fred: "now unable to remove photes not needed and unable to add photes
-- needed ... all of this is in job logs", after "Don't delete it. Just don't
-- include it in the time report". A picture is never deleted for the log; the
-- job remembers which ones the office left out of it.
--
--   work_orders.job_log_left_out   The pictures left out, as 'photo:<wo_photos.id>',
--                                  'receipt:<job_expenses.id>' or 'odo:<job_odometer.id>'.
--                                  Empty: everything is in.
--   work_orders.job_log_receipt_photos
--                                  Site photos labeled receipts ("i can label then as
--                                  recipe or none recipes"): wo_photos ids. They sit
--                                  with the receipts on the log.
--
-- Nothing else changes.

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS job_log_left_out text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS job_log_receipt_photos text[] NOT NULL DEFAULT '{}';
