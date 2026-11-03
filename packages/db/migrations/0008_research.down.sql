DROP TABLE IF EXISTS hiring_watch, featured_openings;
DROP INDEX IF EXISTS companies_tier_inputs_idx;
DROP INDEX IF EXISTS companies_group_idx;
ALTER TABLE companies
  DROP COLUMN IF EXISTS hq_city, DROP COLUMN IF EXISTS hq_state, DROP COLUMN IF EXISTS reach, DROP COLUMN IF EXISTS reach_basis,
  DROP COLUMN IF EXISTS lines_of_business, DROP COLUMN IF EXISTS classified_type, DROP COLUMN IF EXISTS type_set_by_hand,
  DROP COLUMN IF EXISTS group_id, DROP COLUMN IF EXISTS parent_name, DROP COLUMN IF EXISTS parent_source, DROP COLUMN IF EXISTS related_note,
  DROP COLUMN IF EXISTS founded_year, DROP COLUMN IF EXISTS employees, DROP COLUMN IF EXISTS annual_revenue_cents, DROP COLUMN IF EXISTS size_source,
  DROP COLUMN IF EXISTS hiring_categories, DROP COLUMN IF EXISTS hiring_jobs, DROP COLUMN IF EXISTS best_offer, DROP COLUMN IF EXISTS platform_source,
  DROP COLUMN IF EXISTS fit_reason;
DROP TABLE IF EXISTS company_groups;
