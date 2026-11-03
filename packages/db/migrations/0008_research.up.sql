-- 0008 research data, carried over from the artifact's config/ records (class, research, size, founded,
-- groups, fit, featured, watch). It feeds tiering, the Prospects filters and the research panel.

CREATE TABLE company_groups (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  name text NOT NULL,
  note text,
  lines_of_business text[] NOT NULL DEFAULT '{}',
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);

ALTER TABLE companies
  ADD COLUMN hq_city text,
  ADD COLUMN hq_state text,
  ADD COLUMN reach text CHECK (reach IS NULL OR reach IN ('National', 'Regional', 'Unknown')),
  ADD COLUMN reach_basis text,
  ADD COLUMN lines_of_business text[] NOT NULL DEFAULT '{}',
  -- Type from research. The displayed type of a prospect is this, unless someone set `type` by hand.
  ADD COLUMN classified_type text,
  ADD COLUMN type_set_by_hand boolean NOT NULL DEFAULT false,
  ADD COLUMN group_id uuid REFERENCES company_groups(id),
  ADD COLUMN parent_name text,
  ADD COLUMN parent_source text,
  ADD COLUMN related_note text,
  ADD COLUMN founded_year smallint CHECK (founded_year IS NULL OR founded_year BETWEEN 1800 AND 2100),
  ADD COLUMN employees integer CHECK (employees IS NULL OR employees >= 0),
  ADD COLUMN annual_revenue_cents bigint CHECK (annual_revenue_cents IS NULL OR annual_revenue_cents >= 0),
  ADD COLUMN size_source text,
  ADD COLUMN hiring_categories text[] NOT NULL DEFAULT '{}',
  ADD COLUMN hiring_jobs integer CHECK (hiring_jobs IS NULL OR hiring_jobs >= 0),
  ADD COLUMN best_offer text,
  ADD COLUMN platform_source text,
  ADD COLUMN fit_reason text;
CREATE INDEX companies_group_idx ON companies (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX companies_tier_inputs_idx ON companies (research_priority DESC, hiring_signal) WHERE archived_at IS NULL;

-- Today's Featured: companies with a newly posted role we can serve, from the daily hiring scan.
CREATE TABLE featured_openings (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  company_id uuid NOT NULL REFERENCES companies(id),
  first_seen date NOT NULL,
  last_seen date NOT NULL CHECK (last_seen >= first_seen),
  -- [{"title":"...","category":"PEO ops","location":"...","posted":"...","url":"..."}]
  jobs jsonb NOT NULL DEFAULT '[]'::jsonb,
  scan_run_at timestamptz,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE UNIQUE INDEX featured_openings_company_uq ON featured_openings (company_id) WHERE archived_at IS NULL;

-- Organisations the daily hiring scan watches.
CREATE TABLE hiring_watch (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  company_id uuid REFERENCES companies(id),
  name text NOT NULL,
  apollo_org_id text,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_groups', 'featured_openings', 'hiring_watch'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.touch_row()', t || '_touch', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION app.stamp_author()', t || '_author', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (app.can_read())', t || '_read', t);
    -- Research is written by the owner, admin and the worker (the hiring scan).
    EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT WITH CHECK (app.role_in('owner', 'admin', 'system'))$p$, t || '_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE USING (app.role_in('owner', 'admin', 'system')) WITH CHECK (app.role_in('owner', 'admin', 'system'))$p$, t || '_update', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_user', t);
  END LOOP;
END $$;
