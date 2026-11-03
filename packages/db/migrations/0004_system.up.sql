-- 0004 system tables: audit log, AI runs, errors, outbox, idempotency keys.

-- The API sets these per transaction alongside app.user_id and app.role.
CREATE FUNCTION app.setting(name text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.' || name, true), '') $$;

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- person, agent (acting for a person), or system (a job)
  actor_type text NOT NULL CHECK (actor_type IN ('person', 'agent', 'system')),
  actor_id uuid REFERENCES users(id),
  agent_name text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  request_id text,
  ip inet,
  user_agent text,
  before jsonb,
  after jsonb,
  reason text
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, occurred_at);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, occurred_at);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION app.refuse_change();

-- Every insert, update and archive on an audited table writes one audit row in the same transaction,
-- so no code path can change data without leaving a record. Reads are logged by the API.
CREATE FUNCTION app.audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  act text;
  b jsonb;
  a jsonb;
  rid text;
BEGIN
  rid := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ->> 'id' ELSE to_jsonb(NEW) ->> 'id' END;
  IF TG_OP = 'INSERT' THEN
    act := 'create'; a := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    act := 'purge'; b := to_jsonb(OLD);
  ELSE
    b := to_jsonb(OLD); a := to_jsonb(NEW);
    act := CASE
      WHEN b ->> 'archived_at' IS NULL AND a ->> 'archived_at' IS NOT NULL THEN 'archive'
      WHEN b ->> 'archived_at' IS NOT NULL AND a ->> 'archived_at' IS NULL THEN 'restore'
      ELSE 'update' END;
    -- Keep only the fields that changed, to keep the log readable.
    SELECT jsonb_object_agg(k, b -> k), jsonb_object_agg(k, a -> k)
      INTO b, a
      FROM jsonb_object_keys(to_jsonb(NEW)) AS k
      WHERE (to_jsonb(OLD) -> k) IS DISTINCT FROM (to_jsonb(NEW) -> k)
        AND k NOT IN ('updated_at', 'updated_by', 'version');
    IF a IS NULL THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO audit_log (actor_type, actor_id, agent_name, action, entity, entity_id, request_id, ip, user_agent, before, after, reason)
  VALUES (coalesce(app.setting('actor_type'), CASE WHEN app.current_user_id() IS NULL THEN 'system' ELSE 'person' END),
          app.current_user_id(), app.setting('agent_name'), act, TG_TABLE_NAME,
          rid, app.setting('request_id'),
          app.setting('ip')::inet, app.setting('user_agent'), b, a, app.setting('reason'));
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'role_assignments', 'platforms', 'companies', 'contacts', 'deals', 'deal_stage_events',
    'activities', 'tasks', 'outreach_steps', 'proposals', 'proposal_versions', 'clients', 'partners', 'referrals',
    'triggers', 'proof_assets', 'reviews', 'research', 'config_team', 'config_pricing', 'config_plan', 'config_targets',
    'config_cadence', 'config_offers', 'config_objections', 'config_blocked_terms']
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
  END LOOP;
END $$;

CREATE TABLE ai_runs (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  feature text NOT NULL,
  prompt_version text NOT NULL,
  model text NOT NULL,
  user_id uuid REFERENCES users(id),
  input_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  output text,
  status text NOT NULL CHECK (status IN ('ok', 'blocked', 'error')),
  check_failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_tokens integer,
  output_tokens integer,
  cost_micros bigint,
  reviewed_by uuid REFERENCES users(id),
  review text CHECK (review IS NULL OR review IN ('accepted', 'edited', 'rejected')),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_runs_month_idx ON ai_runs (created_at);

CREATE TABLE errors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('client', 'server', 'worker')),
  request_id text,
  user_id uuid REFERENCES users(id),
  route text,
  message text NOT NULL,
  stack text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX errors_time_idx ON errors (occurred_at);

-- Events are written in the same transaction as the data and published afterwards,
-- so data and notifications never disagree.
CREATE TABLE outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox (id) WHERE published_at IS NULL;

-- A retried or double-clicked command returns the first response instead of acting twice.
CREATE TABLE idempotency_keys (
  user_id uuid NOT NULL REFERENCES users(id),
  key text NOT NULL CHECK (length(key) BETWEEN 8 AND 200),
  route text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_age_idx ON idempotency_keys (created_at);
