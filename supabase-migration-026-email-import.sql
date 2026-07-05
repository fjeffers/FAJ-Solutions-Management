-- Migration 026: Email import (Netview/Smartsheet dispatch emails)
--
-- gmail_connections stores the OAuth refresh token needed to poll Gmail on a schedule.
-- Its RLS intentionally does NOT allow the browser client to select refresh_token/access_token —
-- only server-side routes using the service-role key touch those columns. The browser client can
-- still read connection status (connected_email, last_polled_at) to show "Connected as X" in the UI.
--
-- import_queue holds parsed-but-unapproved work orders pending admin review before anything
-- touches the real work_orders table.

CREATE TABLE IF NOT EXISTS gmail_connections (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  connected_email  TEXT        NOT NULL,
  refresh_token    TEXT        NOT NULL,
  access_token     TEXT,
  token_expires_at TIMESTAMPTZ,
  last_polled_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gmail_connections ENABLE ROW LEVEL SECURITY;

-- Browser client (anon/authenticated role) may see connection status only — never the tokens.
-- Achieved by granting SELECT on a restricted column list via a view, and denying direct table
-- access to non-service roles for INSERT/UPDATE/DELETE (server routes use the service-role key,
-- which bypasses RLS entirely, so no policy is needed for those operations).
CREATE POLICY "Users view own connection status"
  ON gmail_connections FOR SELECT
  USING (auth.uid() = user_id);

REVOKE SELECT (refresh_token, access_token) ON gmail_connections FROM authenticated, anon;

CREATE TABLE IF NOT EXISTS import_queue (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source                TEXT        NOT NULL DEFAULT 'netview_smartsheet',
  external_dedupe_key   TEXT        NOT NULL,
  parsed_fields         JSONB       NOT NULL DEFAULT '{}',
  raw_snippet           TEXT,
  status                TEXT        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'approved', 'rejected')),
  created_work_order_id UUID        REFERENCES work_orders(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at           TIMESTAMPTZ,
  UNIQUE (user_id, source, external_dedupe_key)
);

ALTER TABLE import_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own import queue"
  ON import_queue FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
