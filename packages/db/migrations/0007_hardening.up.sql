-- 0007 security hardening, from the independent review of PRs #3 and #5.
--  1. The database no longer trusts the role the caller sends. app.current_role() looks the role up in
--     role_assignments for the signed-in user (and refuses disabled people). 'system' is honoured only for
--     the worker's own database login (a member of app_worker).
--  2. Authors are stamped by the database, not taken from the caller.
--  3. Admins cannot take over or lock out the owner account.
--  4. Specialist scope is complete: no new deals, no moving a deal to another company, no stage events or
--     deal activities on deals that are not theirs.
--  5. AI runs: only the review fields can change. Proposal versions: only the PDF fields, once.
--  6. Audit actor type is derived from the session, not from a setting the caller controls.
--  7. Outbox and errors accept only what each role should write.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN CREATE ROLE app_worker NOLOGIN; END IF;
END $$;
GRANT app_user TO app_worker;

-- 1. Role comes from the database.
CREATE OR REPLACE FUNCTION app.current_role() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  claimed text := nullif(current_setting('app.role', true), '');
  uid uuid := app.current_user_id();
  r text;
BEGIN
  IF claimed = 'system' THEN
    RETURN CASE WHEN uid IS NULL AND pg_has_role(session_user, 'app_worker', 'MEMBER') THEN 'system' ELSE 'none' END;
  END IF;
  IF uid IS NULL THEN RETURN 'none'; END IF;
  SELECT ra.role::text INTO r
    FROM role_assignments ra JOIN users u ON u.id = ra.user_id
   WHERE ra.user_id = uid AND ra.archived_at IS NULL AND u.disabled_at IS NULL AND u.archived_at IS NULL;
  RETURN coalesce(r, 'none');
END $$;

-- Sign-in lookup without needing broad read rights: who is this Entra object id, and what may they do?
CREATE FUNCTION app.resolve_user(p_oid text)
RETURNS TABLE (id uuid, name text, role text, disabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT u.id, u.display_name, ra.role::text, (u.disabled_at IS NOT NULL OR u.archived_at IS NOT NULL)
    FROM users u LEFT JOIN role_assignments ra ON ra.user_id = u.id AND ra.archived_at IS NULL
   WHERE u.entra_oid = p_oid
$$;
REVOKE ALL ON FUNCTION app.resolve_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_user(text) TO app_user;

-- An application session is any session acting through the role checks (a person or the worker).
-- The migrator and loader run with no role and keep the authors they were given.
CREATE FUNCTION app.in_app_session() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app.current_role() <> 'none' $$;

-- 2. Authors are stamped by the database.
CREATE FUNCTION app.stamp_author() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app.in_app_session() THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object('created_by', app.current_user_id(), 'updated_by', app.current_user_id()));
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.touch_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  NEW.updated_by := CASE WHEN app.in_app_session() THEN app.current_user_id() ELSE coalesce(app.current_user_id(), NEW.updated_by) END;
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  NEW.id := OLD.id;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
            WHERE c.table_schema = 'public' AND c.column_name = 'created_by' AND c.table_name <> 'audit_log'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION app.stamp_author()', t || '_author', t);
  END LOOP;
END $$;

-- 3. The owner account is protected.
CREATE FUNCTION app.users_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  IF app.current_role() IN ('owner', 'none') THEN RETURN NEW; END IF;
  IF NEW.entra_oid IS DISTINCT FROM OLD.entra_oid THEN
    RAISE EXCEPTION 'only the owner can change a sign-in identity' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM role_assignments WHERE user_id = OLD.id AND role = 'owner' AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'only the owner can change the owner account' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app.users_guard();

-- 4. Specialist scope.
DROP POLICY deals_insert ON deals;
CREATE POLICY deals_insert ON deals FOR INSERT WITH CHECK (app.role_in('owner', 'admin', 'bd_support', 'system'));

CREATE FUNCTION app.deals_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app.role_in('specialist') AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
    RAISE EXCEPTION 'specialists cannot move or reassign a deal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deals_guard BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION app.deals_guard();

CREATE FUNCTION app.owns_deal(p_deal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT EXISTS (SELECT 1 FROM deals WHERE id = p_deal AND owner_id = app.current_user_id() AND archived_at IS NULL)
$$;

DROP POLICY activities_insert ON activities;
CREATE POLICY activities_insert ON activities FOR INSERT WITH CHECK (
  app.role_in('owner', 'admin', 'bd_support', 'system')
  OR (app.role_in('specialist') AND (deal_id IS NULL OR app.owns_deal(deal_id))));

DROP POLICY deal_stage_events_insert ON deal_stage_events;
CREATE POLICY deal_stage_events_insert ON deal_stage_events FOR INSERT WITH CHECK (
  app.role_in('owner', 'admin', 'bd_support', 'system') OR (app.role_in('specialist') AND app.owns_deal(deal_id)));

-- 5. AI runs and proposal versions.
CREATE FUNCTION app.ai_runs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'review' - 'reviewed_by' - 'reviewed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'review' - 'reviewed_by' - 'reviewed_at') THEN
    RAISE EXCEPTION 'only the review of an AI run can change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.reviewed_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER ai_runs_guard BEFORE UPDATE ON ai_runs FOR EACH ROW EXECUTE FUNCTION app.ai_runs_guard();

CREATE OR REPLACE FUNCTION app.proposal_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'proposal versions cannot be deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF (to_jsonb(NEW) - 'pdf_blob_path' - 'pdf_sha256') IS DISTINCT FROM (to_jsonb(OLD) - 'pdf_blob_path' - 'pdf_sha256')
     OR (OLD.pdf_blob_path IS NOT NULL AND NEW.pdf_blob_path IS DISTINCT FROM OLD.pdf_blob_path)
     OR (OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256) THEN
    RAISE EXCEPTION 'proposal versions are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- 6. Audit actor type from the session.
CREATE FUNCTION app.actor_type() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN app.current_user_id() IS NULL OR app.current_role() = 'none' THEN 'system'
              WHEN app.setting('agent_name') IS NOT NULL THEN 'agent' ELSE 'person' END
$$;

CREATE OR REPLACE FUNCTION app.audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  act text;
  b jsonb;
  a jsonb;
  rid text;
  uid uuid := CASE WHEN app.current_role() = 'none' THEN NULL ELSE app.current_user_id() END;
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
  VALUES (app.actor_type(), uid, app.setting('agent_name'), act, TG_TABLE_NAME, rid, app.setting('request_id'),
          app.setting('ip')::inet, app.setting('user_agent'), b, a, app.setting('reason'));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.log_event(p_action text, p_entity text, p_entity_id text, p_detail jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  IF NOT app.can_read() THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_action NOT IN ('view', 'export', 'download', 'sign_in', 'sign_out', 'ai_run', 'denied') THEN
    RAISE EXCEPTION 'log_event is for reads and access events, not %', p_action USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO audit_log (actor_type, actor_id, agent_name, action, entity, entity_id, request_id, ip, user_agent, after)
  VALUES (app.actor_type(), app.current_user_id(), app.setting('agent_name'), p_action, p_entity, p_entity_id,
          app.setting('request_id'), app.setting('ip')::inet, app.setting('user_agent'), p_detail);
END $$;

-- 7. Outbox and errors.
DROP POLICY outbox_insert ON outbox;
CREATE POLICY outbox_insert ON outbox FOR INSERT WITH CHECK (app.role_in('owner', 'admin', 'bd_support', 'specialist', 'system'));

DROP POLICY errors_insert ON errors;
CREATE POLICY errors_insert ON errors FOR INSERT WITH CHECK (
  (source = 'client' AND app.is_signed_in() AND user_id = app.current_user_id())
  OR (source = 'server' AND user_id IS NOT DISTINCT FROM app.current_user_id())
  OR (source = 'worker' AND app.role_in('system')));

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;
REVOKE EXECUTE ON FUNCTION app.apply_policies(text, text, text, boolean) FROM app_user, PUBLIC;
