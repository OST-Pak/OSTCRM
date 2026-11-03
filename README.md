# OSTCRM

Hosted version of the Oak Street BD CRM: an SSO-protected web app on Azure with a PostgreSQL database, server-side permissions, an API that AI agents can use safely, and a tested deployment pipeline. The artifact CRM stays the live system until cutover (target Jan 7, 2027).

| Path | What |
|---|---|
| `apps/web` | React web app, one module per view |
| `apps/api` | Fastify API; permissions, rules, AI gateway |
| `apps/worker` | Background jobs |
| `apps/mcp` | MCP server for agents |
| `packages/domain` | Pure business rules with unit tests |
| `packages/db` | Schema, migrations, RLS, artifact migration |
| `packages/contracts` | Shared types and API client |
| `infra` | Terraform (Engineer A) |
| `docs/decisions.md` | Decision log |
| `docs/open-decisions.md` | Questions waiting on Saad |

Working rules for Claude are in `CLAUDE.md`.
