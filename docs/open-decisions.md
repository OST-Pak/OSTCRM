# Open decisions for Saad

Items 1 to 10 come from the brief, with the default the team uses if there is no answer by the end of week 1. Items 11 onward were found while porting and need an answer before the related phase starts.

| # | Decision | Default if unanswered | Blocks |
|---|---|---|---|
| 1 | Cloud provider | Decided Nov 2: Azure | |
| 2 | Microsoft 365 tenant and domain: oakstreethr.com, 9ostech.com, or both? | One tenant; guests from the other domain if needed | Phase 0 |
| 3 | Production URL | crm subdomain of the tenant's domain | Phase 0 |
| 4 | Who holds the Admin role? | Saad only until named | Phase 1 |
| 5 | Can Specialists see the whole pipeline or only their assigned deals? | Whole pipeline, read-only outside their deals | Phase 1 |
| 6 | Will clients or partners ever log in? | No; internal only | Phase 1 |
| 7 | Data location for prospect data | Azure East US 2 | Phase 0 |
| 8 | Monthly AI spend cap | Decided Nov 2: $500 per month | |
| 9 | Cutover date | First week of January 2027 (target Jan 7) | Phase 5 |
| 10 | Names of Engineer A and Engineer B | Fill in before kickoff | Phase 0 |
| 11 | Migration dry runs: the brief loads the real export into staging, but also says production data never goes to staging. Mask the export for dry runs, or use a separate locked-down environment? | Masked export in staging | Phase 4 |
| 12 | Duplicate company pairs (3 today) kept unmerged. Companies are unique on normalized domain in the new schema, so a pair sharing a domain cannot both load. Merge them at migration, or allow a duplicate link? | Load the parent; keep the child as a linked alias row | Phase 1 schema |
| 13 | Scheduled tasks outside the CRM (daily brief, Friday pace review, hiring-signal scan) read and write the artifact database today. After cutover they must use the API or MCP server with a service identity. Who owns that identity? | Engineer A creates a service principal with BD support rights | Phase 3 |
| 14 | Research seed data (platform, size, hiring signal, research priority, national reach) is embedded in the artifact page, not the database. It feeds tier scoring. Migrate it into `companies` research columns? | Yes, migrate into research columns with source and date | Phase 1 schema |
| 15 | The scorecard's "setup week" ends on a hard-coded date (2026-11-02) and some weekly metrics have hard-coded start dates. Keep as config rows? | Yes, config rows | Phase 1 |
| 16 | The brief's current-state section lists 15 collections. The artifact now has 18 plus the audit log (adds config, research, members, audit). The migration covers all of them. | Covered | |
