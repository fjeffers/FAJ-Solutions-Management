-- Migration 008: multiple admin documents per work order
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS doc_urls text[] DEFAULT '{}';
