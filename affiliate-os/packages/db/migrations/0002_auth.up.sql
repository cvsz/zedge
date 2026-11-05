-- Roles, per-organization membership and approval requests (AFF-004).
-- Built-in roles are seeded for every organization by aff_create_organization and cannot be edited or deleted.

CREATE TABLE roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name            text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_-]{1,39}$'),
  permissions     text[] NOT NULL CHECK (cardinality(permissions) BETWEEN 1 AND 40),
  builtin         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE FUNCTION aff_seed_roles(p_org uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO roles (organization_id, name, permissions, builtin) VALUES
    (p_org, 'owner',    ARRAY['*'], true),
    (p_org, 'admin',    ARRAY['read','users.admin','audit.read'], true),
    (p_org, 'editor',   ARRAY['read','catalog.write','campaigns.write','content.write','links.write','publish.schedule'], true),
    (p_org, 'approver', ARRAY['read','approvals.decide','audit.read'], true),
    (p_org, 'viewer',   ARRAY['read'], true)
  ON CONFLICT (organization_id, name) DO NOTHING
$$;

-- Backfill any organization that already exists, then attach users to a role.
SELECT aff_seed_roles(id) FROM organizations;
ALTER TABLE users ADD COLUMN role_name text NOT NULL DEFAULT 'viewer';
ALTER TABLE users ADD COLUMN last_login_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_role_fk FOREIGN KEY (organization_id, role_name) REFERENCES roles (organization_id, name);

CREATE OR REPLACE FUNCTION aff_create_organization(p_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$ DECLARE new_id uuid; BEGIN
  INSERT INTO organizations (name) VALUES (p_name) RETURNING id INTO new_id;
  PERFORM aff_seed_roles(new_id);
  RETURN new_id;
END $$;

CREATE FUNCTION aff_roles_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.builtin THEN RAISE EXCEPTION 'built-in role % cannot be changed or deleted', OLD.name USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roles_guard BEFORE UPDATE OR DELETE ON roles FOR EACH ROW EXECUTE FUNCTION aff_roles_guard();

CREATE TABLE approval_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  kind            text NOT NULL CHECK (kind IN ('publish','raise_autonomy','spend','sensitive_category','link_destination')),
  subject_type    text NOT NULL CHECK (length(subject_type) BETWEEN 1 AND 40),
  subject_id      uuid NOT NULL,
  summary         text NOT NULL CHECK (length(summary) BETWEEN 1 AND 500),
  payload         jsonb NOT NULL DEFAULT '{}',
  fingerprint     text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  requested_by    uuid NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','cancelled','consumed')),
  decided_by      uuid,
  decided_at      timestamptz,
  note            text CHECK (note IS NULL OR length(note) <= 200),
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, requested_by) REFERENCES users (organization_id, id),
  FOREIGN KEY (organization_id, decided_by) REFERENCES users (organization_id, id),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)          -- a second person decides, enforced by the database too
);
CREATE UNIQUE INDEX approvals_one_pending ON approval_requests (organization_id, requested_by, fingerprint) WHERE status = 'pending';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['roles','approval_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = aff_current_org()) WITH CHECK (organization_id = aff_current_org())', t);
    EXECUTE format('GRANT SELECT ON %I TO aff_readonly', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE (permissions), DELETE ON roles TO aff_app;   -- the guard trigger protects built-in roles
GRANT SELECT, INSERT ON approval_requests TO aff_app;
GRANT UPDATE (status, decided_by, decided_at, note, expires_at, consumed_at) ON approval_requests TO aff_app;
GRANT UPDATE (role_name, last_login_at) ON users TO aff_app;
