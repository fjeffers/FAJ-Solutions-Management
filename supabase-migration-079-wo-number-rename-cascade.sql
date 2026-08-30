-- 079: renaming a work order takes its money with it.
--
-- Seven tables hang records off work_orders.wo_number. Four of them
-- (contractor_time_logs, deliverable_submissions, signatures, time_logs) also
-- carry wo_id, so they survive a renumber on their own. Three do not:
--
--   payments        — what a tech was paid
--   expenses        — what the job cost
--   material_usage  — what was fitted
--
-- All three are money, and all three find their job by matching a text number.
-- So changing a work order's number silently orphaned every one of them: the
-- job kept its identity, the money did not follow, and nothing anywhere said
-- so. The payouts simply stopped counting.
--
-- That had to be fixed by hand on 2026-08-30 when a duplicate number was
-- untangled. It should never need a hand again.
--
-- migration-078 already guarantees a number identifies one job. This makes the
-- number safe to CHANGE: the rename carries the money with it, in the same
-- transaction, or it does not happen at all.
--
-- Deliberately explicit rather than dynamic SQL. Three named statements are
-- readable and cannot surprise anyone; a loop over a catalogue query is
-- cleverer and worth nothing here.

CREATE OR REPLACE FUNCTION public.work_order_number_rename_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only when the number actually changed to another real number.
  IF NEW.wo_number IS NOT DISTINCT FROM OLD.wo_number THEN
    RETURN NEW;
  END IF;
  IF OLD.wo_number IS NULL OR btrim(OLD.wo_number) = '' THEN
    RETURN NEW;
  END IF;

  UPDATE payments
     SET wo_number = NEW.wo_number
   WHERE user_id = NEW.user_id AND wo_number = OLD.wo_number;

  UPDATE expenses
     SET wo_number = NEW.wo_number
   WHERE user_id = NEW.user_id AND wo_number = OLD.wo_number;

  UPDATE material_usage
     SET wo_number = NEW.wo_number
   WHERE user_id = NEW.user_id AND wo_number = OLD.wo_number;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_orders_number_rename_cascade ON public.work_orders;

CREATE TRIGGER work_orders_number_rename_cascade
  AFTER UPDATE OF wo_number ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.work_order_number_rename_cascade();
