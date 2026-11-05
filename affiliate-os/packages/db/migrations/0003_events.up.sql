-- Transactional outbox, idempotent consumption and a dead-letter queue (AFF-005).
CREATE TABLE outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  event_id        uuid NOT NULL,
  type            text NOT NULL,
  envelope        jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  UNIQUE (organization_id, event_id)
);
CREATE INDEX outbox_unpublished ON outbox (organization_id, id) WHERE published_at IS NULL;

CREATE TABLE processed_events (        -- one row per (consumer, event): the idempotency record, written in the handler's own transaction
  organization_id uuid NOT NULL REFERENCES organizations (id),
  consumer        text NOT NULL,
  event_id        uuid NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, consumer, event_id)
);

CREATE TABLE delivery_attempts (
  organization_id uuid NOT NULL REFERENCES organizations (id),
  consumer        text NOT NULL,
  event_id        uuid NOT NULL,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  PRIMARY KEY (organization_id, consumer, event_id)
);

CREATE TABLE dead_letters (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  consumer        text NOT NULL,
  event_id        uuid,
  envelope        jsonb NOT NULL,
  error           text NOT NULL,
  attempts        integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  replayed_at     timestamptz
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['outbox','processed_events','delivery_attempts','dead_letters'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = aff_current_org()) WITH CHECK (organization_id = aff_current_org())', t);
    EXECUTE format('GRANT SELECT ON %I TO aff_readonly', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON outbox, processed_events, delivery_attempts, dead_letters TO aff_app;
GRANT UPDATE (published_at, attempts, last_error) ON outbox TO aff_app;
GRANT UPDATE (attempts, last_error) ON delivery_attempts TO aff_app;
GRANT UPDATE (replayed_at) ON dead_letters TO aff_app;
