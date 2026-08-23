-- Migration 060: user-defined formula columns
--
-- Fred asked for "Smartsheet's formula and Monday's formula" in his own app:
-- a column he can define himself, computed from the other columns on the row,
-- without waiting for a developer. Profit margin, effective hourly rate,
-- travel as a share of the job — all questions he can now answer by typing
-- rather than asking.
--
-- The expression is evaluated by lib/formula.ts, which is a real parser, NOT
-- eval(). That matters: this column holds text that a person types and every
-- browser opening the grid will run it. There is no path from a stored string
-- to executing code.
--
-- applies_to leaves room for the same feature over other row types later
-- (assets, work orders) without a second table.

CREATE TABLE IF NOT EXISTS formula_columns (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  expression TEXT        NOT NULL,
  format     TEXT        NOT NULL DEFAULT 'number'
                          CHECK (format IN ('number', 'money', 'percent', 'text')),
  position   INTEGER     NOT NULL DEFAULT 0,
  applies_to TEXT        NOT NULL DEFAULT 'site_visits'
                          CHECK (applies_to IN ('site_visits', 'assets')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Two columns with the same heading make {Margin} ambiguous.
  UNIQUE (user_id, applies_to, name)
);

ALTER TABLE formula_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own formula columns"
  ON formula_columns FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS formula_columns_user_idx
  ON formula_columns (user_id, applies_to, position);
