-- Migration 146: the job log as a sheet the office can edit (2026-10-30).
--
-- Fred: "Used this layout with what we have and I need to edit all of it hours
-- time milages materials etc all of it", with his workbook (Time on site,
-- Mileage, Meals, Materials, Other receipts), editing "Both" in the app and in
-- Excel. The log starts from what the app has; once the office saves an edit,
-- the job keeps its own sheet and the log shows that (lib/job-log-sheet.ts).
--
--   work_orders.job_log_sheet   { time: [{tech, day, in, out, brk}],
--                                 miles: [{tech, day, start, end, miles}],
--                                 meals | materials: [{tech, day, store, amount}],
--                                 other: [{tech, day, for, store, amount}] }
--                               Null: the log shows the app's data, as before.
--
-- Nothing else changes: the clock-ins, the Field Sheet and the receipts stay as
-- they are.

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS job_log_sheet jsonb;
