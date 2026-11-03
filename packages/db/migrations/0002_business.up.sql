-- 0002 business tables. Every table carries id (UUID v7), created_at/by, updated_at/by,
-- version (optimistic concurrency) and archived_at (nothing is hard-deleted from the UI).
-- Fields that vary by record go in `extra` (jsonb), not new tables. Money is integer cents.

CREATE TYPE deal_stage AS ENUM ('Target', 'Contacted', 'Replied', 'Meeting booked', 'Discovery done',
  'Proposal sent', 'Verbal yes', 'Signed', 'Nurture (Q1)', 'Lost');

CREATE TABLE platforms (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  name text NOT NULL,
  vendor text,
  enwage_compatible boolean NOT NULL DEFAULT false,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER platforms_touch BEFORE UPDATE ON platforms FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE UNIQUE INDEX platforms_name_uq ON platforms (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  name text NOT NULL CHECK (length(trim(name)) > 0),
  name_normalized text NOT NULL,
  domain text CHECK (domain IS NULL OR domain = lower(domain)),
  website text,
  phone text,
  type text,
  channel text,
  fit text,
  state text,
  worksite_employees integer CHECK (worksite_employees IS NULL OR worksite_employees >= 0),
  platform_id uuid REFERENCES platforms(id),
  platform_name text,
  size text CHECK (size IS NULL OR size IN ('Small', 'Medium', 'Large')),
  hiring_signal text CHECK (hiring_signal IS NULL OR hiring_signal IN ('strong', 'weak', 'none')),
  research_priority smallint CHECK (research_priority IS NULL OR research_priority BETWEEN 1 AND 5),
  national boolean,
  research_source text,
  research_checked_on date,
  verified_on date,
  owner_id uuid REFERENCES users(id),
  enwage_lead boolean NOT NULL DEFAULT false,
  enwage_why text,
  -- A known duplicate points at the record it duplicates (open decision 12 default).
  duplicate_of uuid REFERENCES companies(id),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER companies_touch BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION app.touch_row();

-- Unique on normalized domain among live, non-duplicate companies.
CREATE UNIQUE INDEX companies_domain_uq ON companies (domain) WHERE archived_at IS NULL AND duplicate_of IS NULL AND domain IS NOT NULL;
CREATE INDEX companies_name_idx ON companies (name_normalized);
CREATE INDEX companies_owner_idx ON companies (owner_id) WHERE archived_at IS NULL;

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  email text CHECK (email IS NULL OR email = lower(email)),
  phone text,
  title text,
  role text,
  linkedin text,
  email_status text,
  source text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER contacts_touch BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE UNIQUE INDEX contacts_email_uq ON contacts (email) WHERE archived_at IS NULL AND email IS NOT NULL;
CREATE INDEX contacts_company_idx ON contacts (company_id);

CREATE TABLE deals (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  company_id uuid NOT NULL REFERENCES companies(id),
  offer text,
  stage deal_stage NOT NULL DEFAULT 'Target',
  stage_changed_on date NOT NULL DEFAULT current_date,
  owner_id uuid REFERENCES users(id),
  staff_seats integer NOT NULL DEFAULT 0 CHECK (staff_seats >= 0),
  manager_seats integer NOT NULL DEFAULT 0 CHECK (manager_seats >= 0),
  expected_monthly_cents bigint CHECK (expected_monthly_cents IS NULL OR expected_monthly_cents >= 0),
  next_step text,
  next_step_on date,
  decision_on date,
  proposal_due_on date,
  proposal_sent_on date,
  contract_due_on date,
  contract_sent_on date,
  signature_due_on date,
  signed_on date,
  target_start_on date,
  lost_reason text,
  objection text,
  economic_buyer_id uuid REFERENCES contacts(id),
  decision_maker_id uuid REFERENCES contacts(id),
  cadence_stage deal_stage,
  cadence_done smallint[] NOT NULL DEFAULT '{}',
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER deals_touch BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION app.touch_row();

-- One open deal per company and offer.
CREATE UNIQUE INDEX deals_open_uq ON deals (company_id, coalesce(offer, ''))
  WHERE archived_at IS NULL AND stage NOT IN ('Signed', 'Lost', 'Nurture (Q1)');
CREATE INDEX deals_stage_idx ON deals (stage) WHERE archived_at IS NULL;
CREATE INDEX deals_owner_idx ON deals (owner_id) WHERE archived_at IS NULL;

CREATE TABLE deal_stage_events (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  deal_id uuid NOT NULL REFERENCES deals(id),
  from_stage deal_stage,
  to_stage deal_stage NOT NULL,
  changed_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id)
);
CREATE INDEX deal_stage_events_deal_idx ON deal_stage_events (deal_id, created_at);
CREATE TRIGGER deal_stage_events_append_only BEFORE UPDATE OR DELETE ON deal_stage_events FOR EACH ROW EXECUTE FUNCTION app.refuse_change();

-- Activities are append-only. A correction is a new row that references the original.
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  company_id uuid REFERENCES companies(id),
  deal_id uuid REFERENCES deals(id),
  contact_id uuid REFERENCES contacts(id),
  type text NOT NULL,
  direction text CHECK (direction IS NULL OR direction IN ('Inbound', 'Outbound')),
  outcome text CHECK (outcome IS NULL OR outcome IN ('Positive', 'Neutral', 'Negative', 'No answer')),
  objection text,
  touch_count integer NOT NULL DEFAULT 1 CHECK (touch_count >= 0),
  occurred_on date NOT NULL,
  summary text,
  source text,
  corrects_id uuid REFERENCES activities(id),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id)
);
CREATE INDEX activities_company_idx ON activities (company_id, occurred_on DESC);
CREATE INDEX activities_date_idx ON activities (occurred_on);
CREATE TRIGGER activities_append_only BEFORE UPDATE OR DELETE ON activities FOR EACH ROW EXECUTE FUNCTION app.refuse_change();

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  title text NOT NULL,
  assignee_id uuid REFERENCES users(id),
  due_on date,
  done_at timestamptz,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'cadence', 'ai')),
  company_id uuid REFERENCES companies(id),
  deal_id uuid REFERENCES deals(id),
  notes text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER tasks_touch BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE INDEX tasks_open_idx ON tasks (assignee_id, due_on) WHERE done_at IS NULL AND archived_at IS NULL;

CREATE TABLE outreach_steps (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  company_id uuid REFERENCES companies(id),
  contact_id uuid REFERENCES contacts(id),
  sequence text,
  channel text,
  planned_on date,
  status text NOT NULL,
  last_event_on date,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER outreach_steps_touch BEFORE UPDATE ON outreach_steps FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE TABLE proposals (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  company_id uuid NOT NULL REFERENCES companies(id),
  deal_id uuid REFERENCES deals(id),
  number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Sent')),
  latest_version integer NOT NULL DEFAULT 0,
  sent_version integer,
  sent_at timestamptz,
  monthly_cents bigint NOT NULL DEFAULT 0 CHECK (monthly_cents >= 0),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER proposals_touch BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION app.touch_row();

-- Proposal versions are snapshots and never change once written.
CREATE TABLE proposal_versions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  proposal_id uuid NOT NULL REFERENCES proposals(id),
  v integer NOT NULL CHECK (v >= 1),
  snapshot jsonb NOT NULL,
  monthly_cents bigint NOT NULL CHECK (monthly_cents >= 0),
  note text,
  pdf_blob_path text,
  pdf_sha256 text CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$'),
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  UNIQUE (proposal_id, v)
);
-- The PDF path and hash may be filled in once after the worker renders it; nothing else may change.
CREATE FUNCTION app.proposal_version_guard() RETURNS trigger
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
CREATE TRIGGER proposal_versions_guard BEFORE UPDATE OR DELETE ON proposal_versions FOR EACH ROW EXECUTE FUNCTION app.proposal_version_guard();

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  company_id uuid REFERENCES companies(id),
  won_deal_id uuid REFERENCES deals(id),
  name text NOT NULL,
  started_on date,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER clients_touch BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE TABLE partners (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  name text NOT NULL,
  kind text,
  website text,
  domain text,
  is_peo_broker boolean NOT NULL DEFAULT true,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER partners_touch BEFORE UPDATE ON partners FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  partner_id uuid REFERENCES partners(id),
  company_id uuid REFERENCES companies(id),
  status text NOT NULL,
  introduced_on date,
  payout_cents bigint CHECK (payout_cents IS NULL OR payout_cents >= 0),
  paid_on date,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER referrals_touch BEFORE UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE TABLE triggers (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  company_id uuid NOT NULL REFERENCES companies(id),
  type text NOT NULL,
  text text NOT NULL,
  source_url text,
  occurred_on date,
  -- 'day' or 'month' (a month-only date is stored as the 15th)
  date_precision text NOT NULL DEFAULT 'day' CHECK (date_precision IN ('day', 'month')),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER triggers_touch BEFORE UPDATE ON triggers FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE TABLE proof_assets (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  kind text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  blob_path text,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER proof_assets_touch BEFORE UPDATE ON proof_assets FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  kind text NOT NULL,
  text text NOT NULL,
  ai_run_id uuid,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Approved', 'Rejected')),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER reviews_touch BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE TABLE research (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),

  company_id uuid NOT NULL REFERENCES companies(id),
  summary text,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_drafted boolean NOT NULL DEFAULT true,
  confirmed_by uuid REFERENCES users(id),
  confirmed_at timestamptz,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT app.current_user_id() REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE TRIGGER research_touch BEFORE UPDATE ON research FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE INDEX research_company_idx ON research (company_id);
