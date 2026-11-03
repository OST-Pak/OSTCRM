-- 0006 proposal template as owner-editable, effective-dated config (it lived in the artifact's config/proposalTemplate).

CREATE TABLE config_proposal_template (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  subject text NOT NULL,
  intro text NOT NULL,
  -- [{"service":"...","kind":"staff","seats":2,"priceCents":220000}, ...]
  lines jsonb NOT NULL,
  scope text NOT NULL,
  pilot_text text NOT NULL,
  terms text NOT NULL,
  closing text NOT NULL,
  valid_days integer NOT NULL DEFAULT 14 CHECK (valid_days BETWEEN 1 AND 90),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX config_proposal_template_current_uq ON config_proposal_template ((true)) WHERE effective_to IS NULL AND archived_at IS NULL;
CREATE TRIGGER config_proposal_template_touch BEFORE UPDATE ON config_proposal_template FOR EACH ROW EXECUTE FUNCTION app.touch_row();
CREATE TRIGGER config_proposal_template_audit AFTER INSERT OR UPDATE OR DELETE ON config_proposal_template FOR EACH ROW EXECUTE FUNCTION app.audit_row();

ALTER TABLE config_proposal_template ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_proposal_template_read ON config_proposal_template FOR SELECT USING (app.can_read());
CREATE POLICY config_proposal_template_insert ON config_proposal_template FOR INSERT WITH CHECK (app.role_in('owner', 'admin'));
CREATE POLICY config_proposal_template_update ON config_proposal_template FOR UPDATE USING (app.role_in('owner', 'admin')) WITH CHECK (app.role_in('owner', 'admin'));
GRANT SELECT, INSERT, UPDATE ON config_proposal_template TO app_user;
