-- Migration 061: assets and preventive maintenance — the CMMS core
--
-- A CMMS is normally aimed at equipment YOU own. Fred does not own the racks,
-- switches, cameras and menu boards he works on — they belong to the client's
-- sites. The useful shape here is therefore an asset register PER SITE, and
-- recurring tasks against those assets, so "every camera at every Wendy's needs
-- cleaning quarterly" becomes a list of what is due rather than something he
-- has to remember.
--
-- The point of connection to the rest of the app is that a due task turns into
-- a site_visit. Maintenance that does not become billable work is just a
-- reminder; this closes the loop into the pipeline that already exists.

CREATE TABLE IF NOT EXISTS assets (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Sites are identified the way site_visits identifies them, by program +
  -- site_code, so the two line up without a migration of existing visits.
  customer_id   UUID        REFERENCES customers(id) ON DELETE SET NULL,
  program       TEXT,
  site_code     TEXT,
  site_name     TEXT,
  name          TEXT        NOT NULL,
  asset_type    TEXT,
  manufacturer  TEXT,
  model         TEXT,
  serial        TEXT,
  location_in_site TEXT,
  installed_on  DATE,
  status        TEXT        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'needs_repair', 'retired')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own assets"
  ON assets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS assets_site_idx ON assets (user_id, program, site_code);

-- A recurring task. asset_id null means the task is against the SITE rather
-- than one piece of kit ("clean all cameras"), which is how most of Fred's
-- recurring work is actually scoped.
CREATE TABLE IF NOT EXISTS maintenance_plans (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id      UUID        REFERENCES assets(id) ON DELETE CASCADE,
  program       TEXT,
  site_code     TEXT,
  site_name     TEXT,
  task          TEXT        NOT NULL,
  interval_days INTEGER     NOT NULL CHECK (interval_days > 0),
  last_done_on  DATE,
  -- Stored rather than derived, so the first one can be scheduled before any
  -- work has been done, and so a one-off reschedule sticks.
  next_due_on   DATE,
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE maintenance_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own maintenance plans"
  ON maintenance_plans FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS maintenance_plans_due_idx
  ON maintenance_plans (user_id, active, next_due_on);

-- Which visit discharged which task, so a site's maintenance history is real
-- rather than a date field that was overwritten.
CREATE TABLE IF NOT EXISTS maintenance_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id       UUID        REFERENCES maintenance_plans(id) ON DELETE CASCADE,
  asset_id      UUID        REFERENCES assets(id) ON DELETE SET NULL,
  site_visit_id UUID        REFERENCES site_visits(id) ON DELETE SET NULL,
  done_on       DATE        NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE maintenance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own maintenance events"
  ON maintenance_events FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS maintenance_events_plan_idx
  ON maintenance_events (user_id, plan_id, done_on DESC);
