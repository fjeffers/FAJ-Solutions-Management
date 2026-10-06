-- Migration 108: job messages are readable only by the business they belong to
--
-- The old policy on work_order_messages was
--   FOR ALL USING (auth.uid() = user_id OR user_id IS NULL)
-- with no role and no WITH CHECK. A message with no owner on it could be read,
-- changed or deleted by anyone, even someone not signed in, and anyone could
-- write one. (Found 2026-10-05 while building the owner's Messages screen; the
-- table was still empty, so nothing had been exposed.)
--
-- Every message is written with its owner already set: the owner app inserts
-- its own user id, and techs write through SECURITY DEFINER functions that set
-- the owner (tech_send_message, send_portal_message). Those functions, and
-- get_portal_messages / tech_messages / tech_unread_count, run as the table
-- owner, so this policy does not affect them.

UPDATE work_order_messages m
   SET user_id = w.user_id
  FROM work_orders w
 WHERE m.user_id IS NULL AND w.wo_number = m.work_order_id;

DROP POLICY IF EXISTS "Users manage own messages" ON work_order_messages;
DROP POLICY IF EXISTS "Owner manages job messages" ON work_order_messages;
CREATE POLICY "Owner manages job messages"
  ON work_order_messages FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Nobody signed out touches this table directly; the token portal goes
-- through the functions above.
REVOKE ALL ON work_order_messages FROM anon;
