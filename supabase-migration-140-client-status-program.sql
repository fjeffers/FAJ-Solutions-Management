-- Migration 140: the client's own status and program on a work order (2026-10-24).
--
-- Fred, pasting a row from the LDS tracker ("LDS-1103 5333202 … Pending Tech
-- Assignment … Legacy … Cabling"): "just add these features to the market
-- place ticket number site number etc". The ticket (external_wo_id) and the
-- site number (client_reference) already have a place; these two didn't.
--
--   work_orders.client_status    The client's tracker status, in their words
--                                ("Pending Tech Assignment"). Not the job's stage.
--   work_orders.client_program   The client's program or type ("Legacy").
--
-- Short free text, at most 120 characters each. Nothing else changes.

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS client_status text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS client_program text;
ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_client_status_len;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_client_status_len CHECK (client_status IS NULL OR char_length(client_status) <= 120);
ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_client_program_len;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_client_program_len CHECK (client_program IS NULL OR char_length(client_program) <= 120);
