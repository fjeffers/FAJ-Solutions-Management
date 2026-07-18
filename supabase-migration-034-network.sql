-- Migration 034: Network documentation — port mapping for client sites
--
-- Web-based replacement for the "Office Labeling & Mapping Tracker" Google
-- Sheet. A site (e.g. "Reitler — Floor 20") owns switches and patch panels;
-- each drop is one room/jack record that can reference a switch port and a
-- patch panel port. Port maps (used/free per switch or panel) are derived
-- app-side from drops, so ports themselves are not stored as rows.

CREATE TABLE IF NOT EXISTS network_sites (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE network_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own network sites"
  ON network_sites FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS network_switches (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id    UUID        NOT NULL REFERENCES network_sites(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  model      TEXT,
  port_count INT         NOT NULL DEFAULT 48,
  location   TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE network_switches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own network switches"
  ON network_switches FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_network_switches_site ON network_switches (site_id);

CREATE TABLE IF NOT EXISTS network_patch_panels (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id    UUID        NOT NULL REFERENCES network_sites(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  port_count INT         NOT NULL DEFAULT 24,
  location   TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE network_patch_panels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own network patch panels"
  ON network_patch_panels FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_network_patch_panels_site ON network_patch_panels (site_id);

-- One drop = one room/jack record (a row in the old tracker). switch/panel
-- references are nullable because plenty of drops are known before they're
-- traced to a port. No unique constraint on (switch_id, switch_port): the
-- real world has shared ports and messy data — the UI flags conflicts instead.
CREATE TABLE IF NOT EXISTS network_drops (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id         UUID        NOT NULL REFERENCES network_sites(id) ON DELETE CASCADE,
  room            TEXT        NOT NULL,
  assigned_to     TEXT,
  side            TEXT,
  area_zone       TEXT,
  wall_jack_label TEXT,
  patch_panel_id  UUID        REFERENCES network_patch_panels(id) ON DELETE SET NULL,
  panel_port      INT,
  switch_id       UUID        REFERENCES network_switches(id) ON DELETE SET NULL,
  switch_port     INT,
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'needs_label', 'office_closed')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE network_drops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own network drops"
  ON network_drops FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_network_drops_site   ON network_drops (site_id);
CREATE INDEX IF NOT EXISTS idx_network_drops_switch ON network_drops (switch_id);
CREATE INDEX IF NOT EXISTS idx_network_drops_panel  ON network_drops (patch_panel_id);
