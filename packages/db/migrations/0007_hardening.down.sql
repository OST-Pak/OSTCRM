-- Restores the 0004 to 0006 behaviour.
DROP POLICY errors_insert ON errors;
CREATE POLICY errors_insert ON errors FOR INSERT WITH CHECK (true);
DROP POLICY outbox_insert ON outbox;
CREATE POLICY outbox_insert ON outbox FOR INSERT WITH CHECK (app.can_read());

CREATE OR REPLACE FUNCTION app.log_event(p_action text, p_entity text, p_entity_id text, p_detail jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  IF NOT app.can_read() THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_action NOT IN ('view', 'export', 'download', 'sign_in', 'sign_out', 'ai_run', 'denied') THEN
    RAISE EXCEPTION 'log_event is for reads and access events, not %', p_action USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO audit_log (actor_type, actor_id, agent_name, action, entity, entity_id, request_id, ip, user_agent, after)
  VALUES (coalesce(app.setting('actor_type'), CASE WHEN app.current_user_id() IS NULL THEN 'system' ELSE 'person' END),
          app.current_user_id(), app.setting('agent_name'), p_action, p_entity, p_entity_id,
          app.setting('request_id'), app.setting('ip')::inet, app.setting('user_agent'), p_detail);
END $$;

CREATE OR REPLACE FUNCTION app.audit_row() RETURNS trigger
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
DROP FUNCTION app.actor_type();

CREATE OR REPLACE FUNCTION app.proposal_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'proposal versions cannot be deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.monthly_cents <> OLD.monthly_cents OR NEW.v <> OLD.v
     OR NEW.proposal_id <> OLD.proposal_id OR NEW.note IS DISTINCT FROM OLD.note
     OR (OLD.pdf_blob_path IS NOT NULL AND NEW.pdf_blob_path IS DISTINCT FROM OLD.pdf_blob_path)
     OR (OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256) THEN
    RAISE EXCEPTION 'proposal versions are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER ai_runs_guard ON ai_runs;
DROP FUNCTION app.ai_runs_guard();

DROP POLICY deal_stage_events_insert ON deal_stage_events;
CREATE POLICY deal_stage_events_insert ON deal_stage_events FOR INSERT WITH CHECK (app.role_in('owner', 'admin', 'bd_support', 'specialist', 'system'));
DROP POLICY activities_insert ON activities;
CREATE POLICY activities_insert ON activities FOR INSERT WITH CHECK (app.role_in('owner', 'admin', 'bd_support', 'specialist', 'system') AND created_by IS NOT DISTINCT FROM app.current_user_id());
DROP FUNCTION app.owns_deal(uuid);
DROP TRIGGER deals_guard ON deals;
DROP FUNCTION app.deals_guard();
DROP POLICY deals_insert ON deals;
CREATE POLICY deals_insert ON deals FOR INSERT WITH CHECK (app.role_in('owner', 'admin', 'bd_support', 'system') OR (app.role_in('specialist') AND owner_id = app.current_user_id()));

DROP TRIGGER users_guard ON users;
DROP FUNCTION app.users_guard();

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tgname, tgrelid::regclass AS tbl FROM pg_trigger WHERE tgname LIKE '%\_author' AND NOT tgisinternal LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.tbl);
  END LOOP;
END $$;
DROP FUNCTION app.stamp_author();
CREATE OR REPLACE FUNCTION app.touch_row() RETURNS trigger
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
DROP FUNCTION app.in_app_session();
DROP FUNCTION app.resolve_user(text);

CREATE OR REPLACE FUNCTION app.current_role() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'none') $$;
-- app_worker is a cluster-wide role and is left in place.
