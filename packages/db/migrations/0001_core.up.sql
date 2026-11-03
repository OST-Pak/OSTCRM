-- 0001 core: helper functions, application role, people and roles.

CREATE SCHEMA IF NOT EXISTS app;

-- The API connects as a member of app_user, never as the table owner, so row-level security applies.
-- Engineer A grants this role to the managed identity's login in infra.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA app TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

-- UUID v7: time-ordered ids (RFC 9562). Postgres 16 has no built-in.
CREATE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
BEGIN
  b := set_byte(b, 0, ((ms >> 40) & 255)::int);
  b := set_byte(b, 1, ((ms >> 32) & 255)::int);
  b := set_byte(b, 2, ((ms >> 24) & 255)::int);
  b := set_byte(b, 3, ((ms >> 16) & 255)::int);
  b := set_byte(b, 4, ((ms >> 8) & 255)::int);
  b := set_byte(b, 5, (ms & 255)::int);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);  -- version 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);  -- variant 10
  RETURN encode(b, 'hex')::uuid;
END $$;

-- The API sets these per transaction: SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true).
CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app.current_role() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'none') $$;

-- Role checks used by policies. 'system' is the background worker, which has no user.
CREATE FUNCTION app.role_in(VARIADIC roles text[]) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app.current_role() = ANY(roles) $$;

CREATE FUNCTION app.is_signed_in() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app.current_user_id() IS NOT NULL AND app.current_role() IN ('owner', 'admin', 'bd_support', 'specialist', 'read_only') $$;

CREATE FUNCTION app.can_read() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app.is_signed_in() OR app.current_role() = 'system' $$;

-- Optimistic concurrency: every update must send the version it read; the trigger bumps it.
-- A stale version updates zero rows; the API turns that into a 409 "changed by someone else".
CREATE FUNCTION app.touch_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  NEW.updated_by := coalesce(app.current_user_id(), NEW.updated_by);
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  NEW.id := OLD.id;
  RETURN NEW;
END $$;

-- Append-only tables refuse updates and deletes, whoever asks.
CREATE FUNCTION app.refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TYPE app_role AS ENUM ('owner', 'admin', 'bd_support', 'specialist', 'read_only');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  entra_oid text UNIQUE,
  email text NOT NULL,
  display_name text NOT NULL,
  disabled_at timestamptz,
  legacy_uid text UNIQUE,
  legacy_team_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE archived_at IS NULL;
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE TABLE role_assignments (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL REFERENCES users(id),
  role app_role NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
-- One live role per person. A role change archives the old row and inserts a new one.
CREATE UNIQUE INDEX role_assignments_live_uq ON role_assignments (user_id) WHERE archived_at IS NULL;
CREATE TRIGGER role_assignments_touch BEFORE UPDATE ON role_assignments FOR EACH ROW EXECUTE FUNCTION app.touch_row();
