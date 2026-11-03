# @ostcrm/db

Schema, numbered migrations with down paths, row-level security, and (next PR) the artifact migration.

## Migrations

`migrations/NNNN_name.up.sql` and `NNNN_name.down.sql`, numbered consecutively. The runner (`src/migrate.ts`):
- applies each migration in its own transaction under an advisory lock, so two deploys cannot migrate at once;
- refuses to run if a migration that already ran has been edited (checksum), so changes always go in a new migration;
- rolls back with `migrate down --steps N`.

```
DATABASE_URL=... pnpm --filter @ostcrm/db migrate up
DATABASE_URL=... pnpm --filter @ostcrm/db migrate down --steps 1
```

| Migration | What |
|---|---|
| 0001 core | UUID v7, request-context functions, version bump trigger, append-only guard, `users`, `role_assignments` |
| 0002 business | companies, contacts, deals, deal_stage_events, activities, tasks, outreach_steps, proposals, proposal_versions, clients, partners, referrals, triggers, proof_assets, reviews, research, platforms |
| 0003 config | team, pricing, plan, targets, cadence, offers, objections, blocked terms; effective-dated |
| 0004 system | audit_log with a trigger on every business table, ai_runs, errors, outbox, idempotency_keys |
| 0005 rls | Grants to `app_user` and row-level security per role |

## How access is enforced in the database

The API connects as a member of `app_user` (never the table owner) and, inside each transaction, calls `setRequestContext` with the person's id and role. Policies then decide what each role can read and change. The API's permission checks come first; these policies are the second layer.

| Role | Reads | Changes |
|---|---|---|
| owner | everything | everything; only role that changes roles or purges records archived 90+ days |
| admin | everything | config, users, settings-like records, pipeline |
| bd_support | pipeline, proposals | pipeline, tasks, activities, proposals, referrals |
| specialist | pipeline, proposals | deals assigned to them, tasks, activities |
| read_only | pipeline (no proposals) | nothing |
| system (worker) | pipeline | imports, PDF path on proposal versions, outbox |

Activities, stage events and the audit log are append-only for everyone, including the table owner. Proposal versions never change, except the worker filling in the PDF path and hash once.

## Tests

Tests run against a real PostgreSQL 16 and create a fresh database per file:

```
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @ostcrm/db test
```
