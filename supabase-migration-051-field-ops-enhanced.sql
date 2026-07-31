-- Migration 051: Enhanced field operations
--
-- Adds contractor assignment to site visits and total project price field
-- for better tracking of both hourly and fixed-price work.

-- Link site visits to contractors
ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL;

-- Separate field for total project price (vs hourly rate in text field)
ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS total_project_price NUMERIC;

-- Index for contractor queries
CREATE INDEX IF NOT EXISTS idx_site_visits_contractor ON site_visits (contractor_id);

-- W9 form data storage in contractors
-- The portal already captures w9_submitted_at; these fields store the actual form data
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS w9_file_path TEXT;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS w9_received BOOLEAN DEFAULT FALSE;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS w9_uploaded_by TEXT;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS w9_uploaded_at TIMESTAMPTZ;

-- Track whether contractor has been sent W9 invite
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS w9_invite_sent_at TIMESTAMPTZ;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS w9_invite_token TEXT UNIQUE;
