-- Migration 036: Network projects — group floors under one client project
--
-- "Reitler" is one project with two floors. network_projects sits above
-- network_sites (which now act as floors: name "Floor 20", project_id set).
-- Existing flat sites are backfilled into a "Reitler" project by the data
-- seed run alongside this migration.

CREATE TABLE IF NOT EXISTS network_projects (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE network_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own network projects"
  ON network_projects FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE network_sites
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES network_projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_network_sites_project ON network_sites (project_id);
