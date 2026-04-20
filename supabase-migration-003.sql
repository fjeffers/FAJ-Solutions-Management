-- ============================================================
-- MIGRATION 003 — FieldNation-Style Work Orders
-- Run in Supabase SQL Editor
-- ============================================================

alter table public.work_orders
  -- Core
  add column if not exists title text,
  add column if not exists wo_status text not null default 'Open',

  -- Pay type
  add column if not exists pay_type text not null default 'Fixed',
  add column if not exists hourly_rate numeric,
  add column if not exists hours_worked numeric,
  add column if not exists per_device_rate numeric,
  add column if not exists device_count integer,
  add column if not exists blended_base numeric,

  -- Site / Location
  add column if not exists site_name text,
  add column if not exists site_address text,
  add column if not exists site_city text,
  add column if not exists site_state text,
  add column if not exists site_zip text,

  -- Schedule (time-of-day windows)
  add column if not exists start_time text,
  add column if not exists end_time text,

  -- Scope
  add column if not exists deliverables text,
  add column if not exists service_type text,
  add column if not exists required_skills text;

-- Backfill existing rows so status is consistent
update public.work_orders
set wo_status = 'Open', pay_type = 'Fixed'
where wo_status is null or pay_type is null;

-- ============================================================
-- WO STATUS VALUES (for reference)
-- Open | Assigned | In Progress | Work Done | Approved | Paid
--
-- PAY TYPE VALUES
-- Fixed | Hourly | Per Device | Blended
-- ============================================================
