-- 078: one work order number, one job.
--
-- On 2026-08-30 a new job was created carrying 19101358, a number an existing
-- closed job already had. Because payments join work orders by wo_number rather
-- than by id, $179.95 paid to Bryant Knight and Davis Sanders on the older job
-- immediately read as a payout on the new one. Two jobs, one number, and the
-- money silently crossed between them.
--
-- Nothing in the database prevented it. The app picked the next number with
-- "highest + 1" and never checked whether that number was free, and a typed-in
-- number was never checked at all.
--
-- Money keys must be unique. This makes the database refuse the collision
-- outright, so no future numbering bug — in this app, an import, or a manual
-- entry — can cross one job's payouts onto another.
--
-- Scoped per owner: two different FAJ accounts may legitimately both have a
-- work order 1001. Blank and NULL numbers are excluded so the index never
-- blocks a draft; there are none today.

CREATE UNIQUE INDEX IF NOT EXISTS work_orders_user_wo_number_key
  ON public.work_orders (user_id, wo_number)
  WHERE wo_number IS NOT NULL AND btrim(wo_number) <> '';
