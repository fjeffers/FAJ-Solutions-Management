-- Audit trail for tracking all changes
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,           -- 'create', 'update', 'delete'
  entity_type text NOT NULL,      -- 'work_order', 'payment', 'contractor'
  entity_id uuid,
  entity_label text,              -- human-readable label e.g. "WO#1045" or contractor name
  changes jsonb DEFAULT '{}',     -- what changed (old -> new for updates)
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
