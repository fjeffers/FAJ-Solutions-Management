-- Migration 148: one $ per hour for all the techs' hours on the client's copy of the job log (2026-10-30).
--
-- Fred: "72 hours + 100 i want to have it as an option not sure why but the client is pushing back", "the rate is
-- changing 100, 90, 60", "not a flat rate hourly". With it set, the client's copy charges every tech's hours at
-- this one rate, on one line, in place of each tech's own $ per hour; each tech's $ per mile stays as set
-- (lib/job-log-rates.ts withAllHoursRate). Null: each tech's own rate.
--
-- On job_log_rates (migration 147), so it's owner only like the rates themselves.

ALTER TABLE public.job_log_rates
  ADD COLUMN IF NOT EXISTS all_hours_rate numeric
    CONSTRAINT job_log_rates_all_hours_rate CHECK (all_hours_rate IS NULL OR (all_hours_rate >= 0 AND all_hours_rate < 100000));
