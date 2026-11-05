-- Persistent cost ledger and budgets (AFF-008b). Integer minor units + ISO currency; idempotent per organization.
CREATE TABLE budgets (
  organization_id uuid NOT NULL REFERENCES organizations (id),
  category        text NOT NULL,                 -- '*' = all categories together
  period_minor    bigint NOT NULL CHECK (period_minor >= 0),
  currency        text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  PRIMARY KEY (organization_id, category)
);
CREATE TABLE cost_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  category        text NOT NULL CHECK (length(category) BETWEEN 1 AND 60 AND category <> '*'),
  amount_minor    bigint NOT NULL CHECK (amount_minor >= 0),
  currency        text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  period          text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  note            text CHECK (note IS NULL OR length(note) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX cost_entries_period ON cost_entries (organization_id, period, category);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['budgets','cost_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = aff_current_org()) WITH CHECK (organization_id = aff_current_org())', t);
    EXECUTE format('GRANT SELECT ON %I TO aff_readonly', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON cost_entries TO aff_app;          -- entries are never edited or deleted
GRANT SELECT, INSERT ON budgets TO aff_app;
GRANT UPDATE (period_minor, currency) ON budgets TO aff_app;
