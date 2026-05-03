-- Migration 009: direct deposit / ACH banking info on contractors
ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS bank_name           text,
  ADD COLUMN IF NOT EXISTS account_holder_name text,
  ADD COLUMN IF NOT EXISTS routing_number      text,
  ADD COLUMN IF NOT EXISTS account_number      text,
  ADD COLUMN IF NOT EXISTS account_type        text DEFAULT 'checking';
