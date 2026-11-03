-- 0005 grants and row-level security. The API's permission middleware is the first control;
-- these policies are the second layer and stop any query that slips past it.
-- Roles: owner, admin, bd_support, specialist, read_only, plus system for the background worker.

-- Helper to apply a standard set of policies.
--   readers: who may SELECT     writers: who may INSERT and UPDATE
--   purge: the owner may DELETE rows archived for more than 90 days
CREATE FUNCTION app.apply_policies(tbl text, readers text, writers text, purge boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (%s)', tbl || '_read', tbl, readers);
  EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (%s)', tbl || '_insert', tbl, writers);
  EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (%s) WITH CHECK (%s)', tbl || '_update', tbl, writers, writers);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_user', tbl);
  IF purge THEN
    EXECUTE format($p$CREATE POLICY %I ON %I FOR DELETE USING (app.role_in('owner') AND archived_at IS NOT NULL AND archived_at < now() - interval '90 days')$p$, tbl || '_purge', tbl);
    EXECUTE format('GRANT DELETE ON %I TO app_user', tbl);
  END IF;
END $$;

-- Pipeline records: everyone signed in reads; owner, admin and BD support change; the worker imports.
SELECT app.apply_policies(t, 'app.can_read()', $w$app.role_in('owner', 'admin', 'bd_support', 'system')$w$, true)
  FROM unnest(ARRAY['companies', 'contacts', 'outreach_steps', 'triggers', 'research']) AS t;

-- Deals: a Specialist may change only deals assigned to them.
SELECT app.apply_policies('deals', 'app.can_read()',
  $w$app.role_in('owner', 'admin', 'bd_support', 'system') OR (app.role_in('specialist') AND owner_id = app.current_user_id())$w$, true);

-- Tasks: anyone who can work deals, including Specialists.
SELECT app.apply_policies('tasks', 'app.can_read()', $w$app.role_in('owner', 'admin', 'bd_support', 'specialist', 'system')$w$, true);

-- Proposals: Read only users do not see them; owner, admin and BD support build them.
SELECT app.apply_policies('proposals', $r$app.role_in('owner', 'admin', 'bd_support', 'specialist', 'system')$r$,
  $w$app.role_in('owner', 'admin', 'bd_support')$w$, true);

-- Settings-like records: admin and owner change them.
SELECT app.apply_policies(t, 'app.can_read()', $w$app.role_in('owner', 'admin', 'system')$w$, true)
  FROM unnest(ARRAY['platforms', 'clients', 'partners', 'proof_assets', 'reviews']) AS t;

SELECT app.apply_policies('referrals', 'app.can_read()', $w$app.role_in('owner', 'admin', 'bd_support')$w$, true);

SELECT app.apply_policies(t, 'app.can_read()', $w$app.role_in('owner', 'admin')$w$, false)
  FROM unnest(ARRAY['config_team', 'config_pricing', 'config_plan', 'config_targets', 'config_cadence',
    'config_offers', 'config_objections', 'config_blocked_terms']) AS t;

-- Append-only tables: insert and read only (their triggers also refuse UPDATE and DELETE).
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY activities_read ON activities FOR SELECT USING (app.can_read());
CREATE POLICY activities_insert ON activities FOR INSERT WITH CHECK (app.role_in('owner', 'admin', 'bd_support', 'specialist', 'system') AND created_by IS NOT DISTINCT FROM app.current_user_id());
GRANT SELECT, INSERT ON activities TO app_user;

ALTER TABLE deal_stage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_stage_events_read ON deal_stage_events FOR SELECT USING (app.can_read());
CREATE POLICY deal_stage_events_insert ON deal_stage_events FOR INSERT WITH CHECK (app.role_in('owner', 'admin', 'bd_support', 'specialist', 'system'));
GRANT SELECT, INSERT ON deal_stage_events TO app_user;

ALTER TABLE proposal_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY proposal_versions_read ON proposal_versions FOR SELECT USING (app.role_in('owner', 'admin', 'bd_support', 'specialist', 'system'));
CREATE POLICY proposal_versions_insert ON proposal_versions FOR INSERT WITH CHECK (app.role_in('owner', 'admin', 'bd_support'));
-- Only the worker fills in the rendered PDF path and hash; the guard trigger blocks every other change.
CREATE POLICY proposal_versions_pdf ON proposal_versions FOR UPDATE USING (app.role_in('system')) WITH CHECK (app.role_in('system'));
GRANT SELECT, INSERT, UPDATE ON proposal_versions TO app_user;

-- People: everyone signed in can see who is on the team; admin and owner manage records.
SELECT app.apply_policies('users', 'app.can_read()', $w$app.role_in('owner', 'admin')$w$, false);

-- Role changes are owner-only. People can see their own role; owner and admin see everyone's.
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_assignments_read ON role_assignments FOR SELECT
  USING (app.role_in('owner', 'admin', 'system') OR user_id = app.current_user_id());
CREATE POLICY role_assignments_insert ON role_assignments FOR INSERT WITH CHECK (app.role_in('owner'));
CREATE POLICY role_assignments_update ON role_assignments FOR UPDATE USING (app.role_in('owner')) WITH CHECK (app.role_in('owner'));
GRANT SELECT, INSERT, UPDATE ON role_assignments TO app_user;

-- Audit log: owner and admin read. Nobody writes directly; rows come from the audit trigger
-- and from app.log_event, which stamps the real actor so it cannot be forged.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_read ON audit_log FOR SELECT USING (app.role_in('owner', 'admin'));
GRANT SELECT ON audit_log TO app_user;

CREATE FUNCTION app.log_event(p_action text, p_entity text, p_entity_id text, p_detail jsonb DEFAULT NULL) RETURNS void
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
REVOKE ALL ON FUNCTION app.log_event(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.log_event(text, text, text, jsonb) TO app_user;

-- AI runs: people see their own; owner and admin see all. The reviewer updates the review fields.
ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_runs_read ON ai_runs FOR SELECT USING (app.role_in('owner', 'admin', 'system') OR user_id = app.current_user_id());
CREATE POLICY ai_runs_insert ON ai_runs FOR INSERT WITH CHECK (app.can_read() AND user_id IS NOT DISTINCT FROM app.current_user_id());
CREATE POLICY ai_runs_review ON ai_runs FOR UPDATE USING (user_id = app.current_user_id() OR app.role_in('owner', 'admin'))
  WITH CHECK (reviewed_by = app.current_user_id());
GRANT SELECT, INSERT, UPDATE ON ai_runs TO app_user;

ALTER TABLE errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY errors_read ON errors FOR SELECT USING (app.role_in('owner', 'admin'));
CREATE POLICY errors_insert ON errors FOR INSERT WITH CHECK (true);
GRANT SELECT, INSERT ON errors TO app_user;

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_insert ON outbox FOR INSERT WITH CHECK (app.can_read());
CREATE POLICY outbox_worker ON outbox FOR SELECT USING (app.role_in('system'));
CREATE POLICY outbox_publish ON outbox FOR UPDATE USING (app.role_in('system')) WITH CHECK (app.role_in('system'));
GRANT SELECT, INSERT, UPDATE ON outbox TO app_user;

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_own ON idempotency_keys FOR ALL USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
GRANT SELECT, INSERT, UPDATE ON idempotency_keys TO app_user;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;
REVOKE EXECUTE ON FUNCTION app.apply_policies(text, text, text, boolean) FROM app_user, PUBLIC;
