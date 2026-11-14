-- Migration 154: techs can't read or change work_orders rows directly.
--
-- contractors_view_own_workorders (migration 004, re-made in 150) and
-- contractors_update_wo_status (migration 004) let any login whose email
-- matched a contractor select or patch whole work_orders rows through the
-- table API, money columns included (total_amount, hourly_rate,
-- contractor_pay, pay_addons, billable_*, ...). Migration 138 already took pay
-- out of the tech functions; these two policies left a way around that.
--
-- The tech app never touches the table: every read and write goes through the
-- SECURITY DEFINER tech_* / wf_tech_* functions, which pick the caller with
-- tech_ctx() (auth_user_id + portal_enabled + owner) and return no money. The
-- office keeps its own user_id policies, so nothing changes for Fred.
-- Safe to run more than once.

DROP POLICY IF EXISTS "contractors_view_own_workorders" ON public.work_orders;
DROP POLICY IF EXISTS "contractors_update_wo_status" ON public.work_orders;
