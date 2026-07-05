-- Migration 028: enable Realtime on core business tables
-- app/page.tsx subscribes to postgres_changes on these tables so that multiple
-- open tabs/devices stay in sync without manual refreshes (same pattern as
-- migration-025 for work_order_messages). Realtime respects the existing
-- user_id RLS policies, so only the owner's authenticated sessions receive events.

ALTER PUBLICATION supabase_realtime ADD TABLE work_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
ALTER PUBLICATION supabase_realtime ADD TABLE contractors;
ALTER PUBLICATION supabase_realtime ADD TABLE import_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE contractor_time_logs;
