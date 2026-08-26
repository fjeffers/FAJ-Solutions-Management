-- Migration 070: your own questions on a survey, and contracts in the chain
--
-- ─── Custom questions ───────────────────────────────────────────────────────
--
-- Every job asks something the fixed form does not: "is the ceiling accessible
-- above the drop tile?", "who signs off on the closet?", "is there an existing
-- NVR we are reusing?". Those were living in the Notes box as prose, which
-- means nothing downstream can read them.
--
-- work_orders already carries custom_qa (an array of {id,label,type,answer})
-- and question_templates already stores reusable question sets. Surveys reuse
-- BOTH rather than growing a second, incompatible Q&A system — so a question
-- set built once can be answered on any survey.
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS custom_qa JSONB NOT NULL DEFAULT '[]'::JSONB;

-- ─── Contracts ──────────────────────────────────────────────────────────────
--
-- The chain ran Survey → Quote → Work Order, but the contract sat outside it in
-- Word and got hand-synced to the survey's numbers. That is exactly the drift
-- the chain exists to remove: the Chester contract had to be re-edited by hand
-- when the labour estimate changed.
--
-- A contract is generated FROM an accepted quote, so it inherits the client,
-- the scope and the money instead of restating them. Both links are kept:
-- survey_id so a signed contract traces back to the walk-through, quote_id so
-- the figures can be checked against what was quoted.
CREATE TABLE IF NOT EXISTS contracts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_number TEXT        NOT NULL,          -- C-2026-001

  -- Where it came from. SET NULL, never CASCADE: deleting a quote must not
  -- delete a signed agreement.
  quote_id        UUID        REFERENCES quotes(id)      ON DELETE SET NULL,
  survey_id       UUID        REFERENCES surveys(id)     ON DELETE SET NULL,
  work_order_id   UUID        REFERENCES work_orders(id) ON DELETE SET NULL,
  customer_id     UUID        REFERENCES customers(id)   ON DELETE SET NULL,

  client_name     TEXT,
  client_email    TEXT,
  site_name       TEXT,
  site_address    TEXT,
  title           TEXT,

  status          TEXT        NOT NULL DEFAULT 'draft',  -- draft|sent|signed|declined|void

  -- The clauses. Free text so wording can be adjusted per job, seeded from
  -- defaults in lib/contracts.ts rather than hard-coded in the database.
  scope_of_work   TEXT,
  deliverables    TEXT,
  schedule_terms  TEXT,
  price_terms     TEXT,
  payment_terms   TEXT,
  change_orders   TEXT,
  warranty        TEXT,
  exclusions      TEXT,
  access_safety   TEXT,
  insurance       TEXT,
  termination     TEXT,
  governing_law   TEXT,

  total           NUMERIC     NOT NULL DEFAULT 0,
  deposit_amount  NUMERIC,

  -- Signature block
  provider_signatory TEXT,
  client_signatory   TEXT,
  signed_at          TIMESTAMPTZ,
  signed_name        TEXT,
  signed_ip          TEXT,

  share_token     TEXT,        -- powers /contract/<token>, same pattern as quotes
  sent_at         TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, contract_number)
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own contracts" ON contracts;
CREATE POLICY "Users manage own contracts"
  ON contracts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- The forward link, so a quote knows it has been papered.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_quote     ON contracts (quote_id);
CREATE INDEX IF NOT EXISTS idx_contracts_survey    ON contracts (survey_id);
CREATE INDEX IF NOT EXISTS idx_contracts_customer  ON contracts (customer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status    ON contracts (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_share_token ON contracts (share_token);
CREATE INDEX IF NOT EXISTS idx_quotes_contract     ON quotes (contract_id);
