-- 0003 config: owner-editable settings that were hard-coded in the artifact.
-- Effective-dated: a change closes the current row (effective_to) and inserts a new one,
-- so past reports compute with the values in force at the time. Every change is audited.

CREATE TABLE config_team (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  user_id uuid NOT NULL REFERENCES users(id),
  display_name text NOT NULL,

  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER config_team_touch BEFORE UPDATE ON config_team FOR EACH ROW EXECUTE FUNCTION app.touch_row();

ALTER TABLE config_team ADD CHECK (effective_to IS NULL OR effective_to > effective_from);
CREATE UNIQUE INDEX config_team_current_uq ON config_team (user_id) WHERE effective_to IS NULL AND archived_at IS NULL;

CREATE TABLE config_pricing (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  staff_seat_cents bigint NOT NULL CHECK (staff_seat_cents > 0),
  manager_seat_cents bigint NOT NULL CHECK (manager_seat_cents > 0),

  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER config_pricing_touch BEFORE UPDATE ON config_pricing FOR EACH ROW EXECUTE FUNCTION app.touch_row();

ALTER TABLE config_pricing ADD CHECK (effective_to IS NULL OR effective_to > effective_from);
CREATE UNIQUE INDEX config_pricing_current_uq ON config_pricing ((true)) WHERE effective_to IS NULL AND archived_at IS NULL;

CREATE TABLE config_plan (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  start_on date NOT NULL,
  end_on date NOT NULL,
  deadline_on date NOT NULL,
  setup_until date,
  -- [{"date":"2026-11-06","meetings":2,"proposals":1,"signed":0}, ...]
  points jsonb NOT NULL,
  forecast jsonb NOT NULL DEFAULT '{}'::jsonb,
  off_days date[] NOT NULL DEFAULT '{}',

  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER config_plan_touch BEFORE UPDATE ON config_plan FOR EACH ROW EXECUTE FUNCTION app.touch_row();

ALTER TABLE config_plan ADD CHECK (effective_to IS NULL OR effective_to > effective_from);
CREATE UNIQUE INDEX config_plan_current_uq ON config_plan ((true)) WHERE effective_to IS NULL AND archived_at IS NULL;

CREATE TABLE config_targets (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  metric text NOT NULL,
  label text NOT NULL,
  owner_id uuid REFERENCES users(id),
  target integer NOT NULL CHECK (target >= 0),
  red integer NOT NULL CHECK (red >= 0),
  scored_from date,

  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER config_targets_touch BEFORE UPDATE ON config_targets FOR EACH ROW EXECUTE FUNCTION app.touch_row();

ALTER TABLE config_targets ADD CHECK (effective_to IS NULL OR effective_to > effective_from);
CREATE UNIQUE INDEX config_targets_current_uq ON config_targets (metric) WHERE effective_to IS NULL AND archived_at IS NULL;

CREATE TABLE config_cadence (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  stage deal_stage NOT NULL,
  -- [{"day":0,"channel":"Email","action":"..."}, ...]
  steps jsonb NOT NULL,

  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER config_cadence_touch BEFORE UPDATE ON config_cadence FOR EACH ROW EXECUTE FUNCTION app.touch_row();

ALTER TABLE config_cadence ADD CHECK (effective_to IS NULL OR effective_to > effective_from);
CREATE UNIQUE INDEX config_cadence_current_uq ON config_cadence (stage) WHERE effective_to IS NULL AND archived_at IS NULL;

CREATE TABLE config_offers (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  name text NOT NULL,
  sort integer NOT NULL DEFAULT 0,

  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER config_offers_touch BEFORE UPDATE ON config_offers FOR EACH ROW EXECUTE FUNCTION app.touch_row();

ALTER TABLE config_offers ADD CHECK (effective_to IS NULL OR effective_to > effective_from);
CREATE UNIQUE INDEX config_offers_current_uq ON config_offers (lower(name)) WHERE effective_to IS NULL AND archived_at IS NULL;

CREATE TABLE config_objections (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  name text NOT NULL,
  sort integer NOT NULL DEFAULT 0,

  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER config_objections_touch BEFORE UPDATE ON config_objections FOR EACH ROW EXECUTE FUNCTION app.touch_row();

ALTER TABLE config_objections ADD CHECK (effective_to IS NULL OR effective_to > effective_from);
CREATE UNIQUE INDEX config_objections_current_uq ON config_objections (lower(name)) WHERE effective_to IS NULL AND archived_at IS NULL;

CREATE TABLE config_blocked_terms (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  -- Names that must never appear in proposals or other external output (existing clients).
  term text NOT NULL,

  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER config_blocked_terms_touch BEFORE UPDATE ON config_blocked_terms FOR EACH ROW EXECUTE FUNCTION app.touch_row();

ALTER TABLE config_blocked_terms ADD CHECK (effective_to IS NULL OR effective_to > effective_from);
CREATE UNIQUE INDEX config_blocked_terms_current_uq ON config_blocked_terms (lower(term)) WHERE effective_to IS NULL AND archived_at IS NULL;

