-- Migration 025: enable Realtime on work_order_messages
-- Admin-side chat (components/WorkOrderChatPanel.tsx) subscribes to postgres_changes on
-- this table; without replication enabled the subscription silently never fires.
-- Portal side intentionally stays on polling (see Phase 7 plan notes), so no RLS-for-
-- anonymous-clients concern here — this only affects authenticated admin sessions,
-- which already satisfy the existing user_id RLS policy on SELECT.

ALTER PUBLICATION supabase_realtime ADD TABLE work_order_messages;
