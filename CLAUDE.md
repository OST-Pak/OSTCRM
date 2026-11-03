# OSTCRM: working rules for Claude

This repo is the hosted version of the Oak Street BD CRM. The build brief is "Oak Street BD CRM: Re-platforming and Go-Live Instructions" (Nov 2, 2026; https://claude.ai/artifact/UmNWJEE9LZjBfRmwfCJFF5). Business rules come from "Oak Street BD CRM: Build Instructions for Claude" (https://claude.ai/artifact/WehyjQuYbBNjmuuREpHD9d) and, where that doc is silent, from the behaviour of the live artifact CRM. Read both before changing behaviour; if you cannot open them, ask Saad. `docs/rules-registry.md` maps every registry rule to its code and tests.

Where the two docs differ, the re-platforming brief wins for the hosted app (it is newer and written for it): money in integer cents rather than whole dollars, and five roles (owner, admin, BD support, specialist, read only) rather than Owner, Contributor and Viewer.

## Ownership

- Claude: application code, migrations, tests, API, MCP server.
- Engineer A (platform): cloud account, Terraform in `infra/`, networking, database, secrets, CI/CD.
- Engineer B (security and release): SSO, access reviews, backups and restore tests, cutover runbook.
- Saad: scope, priorities, go/no-go, and every open decision in `docs/open-decisions.md`.

## Rules

1. Port behaviour, not markup. Read the matching view in the artifact, write its rules as test cases first, then implement.
2. Every business rule is a pure function in `packages/domain` with unit tests (90% line coverage minimum). No rule logic in React components or SQL.
3. Every write goes through the API. The browser never talks to the database.
4. Every schema change is a numbered migration with a down path. Never edit a migration that has run in staging.
5. Small pull requests, one concern each, with a test plan in the description. A deployment engineer reviews anything touching auth, infra or data deletion.
6. When a requirement is unclear, stop and add it to `docs/open-decisions.md` rather than guessing.
7. Record any choice that changes behaviour in `docs/decisions.md`.
8. Money is integer cents. Dates are `YYYY-MM-DD` strings; timestamps are UTC.
9. Confidential: never put a client's pricing in code, config, seed data, fixtures or tests. Never name an existing client in outreach, proposals or other external output. The proposal validator enforces the client-name block.
10. Never commit CRM data. Exports from the artifact are production data and go only to the engineers through a private channel.

## Commands

- `pnpm install`
- `pnpm test` runs every package's tests.
- `pnpm typecheck`
