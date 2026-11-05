-- Core schema v1. Every tenant table carries organization_id and is protected by row-level security.
-- No secrets live here: roles are NOLOGIN (the deployment attaches logins and passwords), connection strings stay in the environment.
-- Money is integer minor units plus an ISO currency. Nothing is ever deleted: privileges for DELETE are not granted, rows are retired.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aff_app') THEN CREATE ROLE aff_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aff_readonly') THEN CREATE ROLE aff_readonly NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aff_provisioner') THEN CREATE ROLE aff_provisioner NOLOGIN; END IF;
END $$;

-- The current organization is set per transaction by the data-access layer (SET LOCAL via set_config). Unset means no rows.
CREATE FUNCTION aff_current_org() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  subject         text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),   -- OIDC "sub"
  email           text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name    text CHECK (display_name IS NULL OR length(display_name) <= 200),
  disabled        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, subject)
);

CREATE TABLE brands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  voice           jsonb NOT NULL DEFAULT '{}',          -- brand voice is configuration, not code
  created_at      timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name)
);

CREATE TABLE channels (               -- a connected social account
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id        uuid NOT NULL,
  platform        text NOT NULL CHECK (platform IN ('tiktok','shopee','facebook','instagram','youtube','line','web','other')),
  handle          text NOT NULL CHECK (length(handle) BETWEEN 1 AND 200),
  credential_ref  text CHECK (credential_ref IS NULL OR length(credential_ref) <= 200),   -- a pointer into the secret store, never the secret
  created_at      timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, platform, handle),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands (organization_id, id)
);

CREATE TABLE campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id        uuid NOT NULL,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  autonomy_level  text NOT NULL DEFAULT 'APPROVAL_REQUIRED' CHECK (autonomy_level IN ('MANUAL','DRAFT_ONLY','APPROVAL_REQUIRED','AUTO_PUBLISH_APPROVED_TEMPLATES','AUTONOMOUS_WITH_POLICY')),
  budget_minor    bigint NOT NULL DEFAULT 0 CHECK (budget_minor >= 0),
  currency        char(3) NOT NULL DEFAULT 'THB' CHECK (currency ~ '^[A-Z]{3}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands (organization_id, id)
);

CREATE TABLE content (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  campaign_id     uuid,
  status          text NOT NULL DEFAULT 'IDEA' CHECK (status IN ('IDEA','GENERATING','REVIEW','APPROVED','SCHEDULED','PUBLISHING','PUBLISHED','FAILED','ARCHIVED')),
  language        text NOT NULL CHECK (language IN ('th','en','th-en')),
  format          text NOT NULL CHECK (format IN ('image','video','text','carousel')),
  caption         text CHECK (caption IS NULL OR length(caption) <= 5000),
  disclosure      text NOT NULL CHECK (length(disclosure) BETWEEN 3 AND 300),
  claims          jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(claims) = 'array'),
  autonomy_level  text NOT NULL DEFAULT 'APPROVAL_REQUIRED' CHECK (autonomy_level IN ('MANUAL','DRAFT_ONLY','APPROVAL_REQUIRED','AUTO_PUBLISH_APPROVED_TEMPLATES','AUTONOMOUS_WITH_POLICY')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, campaign_id) REFERENCES campaigns (organization_id, id)
);

CREATE TABLE creatives (               -- immutable: a change is a new row (a variant), so results are never mixed
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  content_id      uuid NOT NULL,
  variant_of      uuid,
  body            jsonb NOT NULL,
  content_hash    text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, content_id) REFERENCES content (organization_id, id),
  FOREIGN KEY (organization_id, variant_of) REFERENCES creatives (organization_id, id)
);

CREATE TABLE affiliate_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  slug            text NOT NULL CHECK (slug ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$'),
  destination     text NOT NULL CHECK (destination ~ '^https://' AND length(destination) <= 2000),
  provider        text NOT NULL DEFAULT 'generic' CHECK (provider ~ '^[a-z0-9_-]{1,40}$'),
  campaign_id     uuid,
  content_id      uuid,
  creative_id     uuid,
  platform        text NOT NULL DEFAULT 'other' CHECK (platform IN ('tiktok','shopee','facebook','instagram','youtube','line','web','other')),
  disclosure      text NOT NULL CHECK (length(disclosure) BETWEEN 3 AND 300),   -- every tracked link carries its disclosure
  enabled         boolean NOT NULL DEFAULT true,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, slug),
  FOREIGN KEY (organization_id, campaign_id) REFERENCES campaigns (organization_id, id),
  FOREIGN KEY (organization_id, content_id)  REFERENCES content (organization_id, id),
  FOREIGN KEY (organization_id, creative_id) REFERENCES creatives (organization_id, id)
);

CREATE TABLE audit_entries (           -- append-only, hash-chained per organization (see AFF-004)
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  seq             bigint NOT NULL CHECK (seq >= 1),
  ts              timestamptz NOT NULL DEFAULT now(),
  actor           text NOT NULL,
  action          text NOT NULL,
  subject_type    text,
  subject_id      text,
  detail          jsonb NOT NULL DEFAULT '{}',
  prev_hash       text NOT NULL,
  hash            text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (organization_id, seq)
);

CREATE INDEX content_org_status ON content (organization_id, status);
CREATE INDEX links_org_campaign ON affiliate_links (organization_id, campaign_id);
CREATE INDEX audit_org_ts ON audit_entries (organization_id, ts);

-- ---- append-only guards (also stop a privileged connection from rewriting history by accident) ----
CREATE FUNCTION aff_forbid_change() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION '% on % is not allowed: rows are append-only or retired, never rewritten', TG_OP, TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_entries FOR EACH ROW EXECUTE FUNCTION aff_forbid_change();

CREATE FUNCTION aff_creative_immutable() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.content_id IS DISTINCT FROM OLD.content_id
     OR NEW.variant_of IS DISTINCT FROM OLD.variant_of OR NEW.body IS DISTINCT FROM OLD.body OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    RAISE EXCEPTION 'creatives are immutable: create a new variant instead' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER creatives_immutable BEFORE UPDATE ON creatives FOR EACH ROW EXECUTE FUNCTION aff_creative_immutable();

-- ---- row-level security: one policy, applied to every tenant table ----
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','brands','channels','campaigns','content','creatives','affiliate_links','audit_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = aff_current_org()) WITH CHECK (organization_id = aff_current_org())', t);
    EXECUTE format('GRANT SELECT ON %I TO aff_readonly', t);
  END LOOP;
END $$;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations USING (id = aff_current_org());
GRANT SELECT ON organizations TO aff_app, aff_readonly;

-- ---- least privilege for the application role: no DELETE anywhere, narrow UPDATE where a change is legitimate ----
GRANT SELECT, INSERT ON users, creatives, audit_entries TO aff_app;
GRANT UPDATE (display_name, email, disabled) ON users TO aff_app;
GRANT SELECT, INSERT, UPDATE ON brands, channels, campaigns, content TO aff_app;
GRANT UPDATE (retired_at) ON creatives TO aff_app;
GRANT SELECT, INSERT ON affiliate_links TO aff_app;
GRANT UPDATE (enabled, expires_at, retired_at, updated_at) ON affiliate_links TO aff_app;

-- Organizations are created by a provisioning role, never by the app role.
CREATE FUNCTION aff_create_organization(p_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$ DECLARE new_id uuid; BEGIN INSERT INTO organizations (name) VALUES (p_name) RETURNING id INTO new_id; RETURN new_id; END $$;
REVOKE ALL ON FUNCTION aff_create_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aff_create_organization(text) TO aff_provisioner;
