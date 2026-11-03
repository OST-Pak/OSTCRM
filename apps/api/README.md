# @ostcrm/api

Fastify and Zod. The only door to the database: the web app, the worker, the MCP server and any future app all use it.

## What every request goes through

1. **Sign-in.** A Microsoft Entra ID access token is required (RS256, our tenant's issuer, our audience, not expired). Identity comes only from the token's `oid`, matched to `users.entra_oid`. Unknown, disabled and role-less people get 403.
2. **Permission.** Every route declares a named action (`config.action`). A route without one, or with an unknown one, stops the server at startup. The role table is in `src/permissions.ts`; refusals are written to the audit log.
3. **Row scope.** Specialists change only deals assigned to them.
4. **One transaction per request**, stamped with the person, role, request id, IP and user agent, so row-level security and the audit trigger apply.

## Rules the routes follow

- **Edits send the version they read.** A stale version returns 409 with the current record.
- **Commands send an `Idempotency-Key` header.** A retry returns the first response; the same key with a different body returns 422.
- **Related writes share one transaction**, and events go to the outbox in the same transaction.
- **Lists page on the server** with a cursor (50 by default, 200 at most); no silent caps.
- **Nothing is hard-deleted.** Archiving a company archives its open deals, tasks and outreach and keeps activities.
- **Bulk export** is its own permission, is logged, and puts an alert in the outbox for the owner. CSV cells that look like formulas are neutralized.
- **Read only** users see phone numbers and emails partly hidden.
- **Errors** are stored in `errors` with the request id; every error response carries the request id.

## Routes so far

| Route | Action |
|---|---|
| `GET /v1/health` | public |
| `GET /v1/me` | pipeline.read |
| `GET /v1/companies`, `GET /v1/companies/:id` | pipeline.read |
| `PATCH /v1/companies/:id` | deal.edit |
| `POST /v1/deals/:id/stage` | deal.edit |
| `POST /v1/activities` | activity.log |
| `POST /v1/companies/:id/archive` | deal.archive |
| `POST /v1/users/:id/role` | role.change |
| `GET /v1/exports/companies.csv` | export.csv |
| `GET /v1/audit` | audit.read |
| `POST /v1/errors` | error.report |

## Running

```
DATABASE_URL=... ENTRA_TENANT_ID=... ENTRA_API_AUDIENCE=... pnpm --filter @ostcrm/api start
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @ostcrm/api test
```

Tests use a fake Entra tenant (a local signing key) and a real PostgreSQL database.
