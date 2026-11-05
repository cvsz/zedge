DROP TABLE IF EXISTS approval_requests CASCADE;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_fk;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
ALTER TABLE users DROP COLUMN IF EXISTS role_name;
DROP TABLE IF EXISTS roles CASCADE;
DROP FUNCTION IF EXISTS aff_roles_guard();
CREATE OR REPLACE FUNCTION aff_create_organization(p_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$ DECLARE new_id uuid; BEGIN INSERT INTO organizations (name) VALUES (p_name) RETURNING id INTO new_id; RETURN new_id; END $$;
DROP FUNCTION IF EXISTS aff_seed_roles(uuid);
