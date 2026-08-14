-- Migration 056: accept/decline responses on work order assignments
-- Map of contractor name -> { status: 'accepted'|'declined', at: ISO timestamp }.
-- Written by /api/portal/respond (one-click links in assignment emails) and
-- readable in the admin UI so Fred knows who has committed to a job.
-- get_portal_data passes it through automatically (to_jsonb(w) minus pay fields).

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assignment_responses JSONB NOT NULL DEFAULT '{}';
