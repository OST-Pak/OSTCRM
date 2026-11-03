# Run the CRM on your own computer (local preview)

Demo data only: fictional companies, no real prospects. Sign-in is a "choose who you are" picker, because Microsoft sign-in needs the Azure app registration. Nothing here talks to the live CRM.

## Option 1: Docker (recommended)

Needs Docker Desktop (https://www.docker.com/products/docker-desktop/), running.

```
cd OSTCRM
docker compose -f docker-compose.local.yml up --build
```

The first run downloads and builds for a few minutes. When the log shows `Local API ready` and `Local:   http://localhost:5173/`, open **http://localhost:5173** in your browser and choose who to sign in as. "Switch person" in the header changes role.

Stop it with Ctrl+C. Your demo data is kept for next time. To start over with fresh demo data:

```
docker compose -f docker-compose.local.yml down -v
```

## Option 2: without Docker

Needs Node.js 22, pnpm 10 and PostgreSQL 16 running locally (for example from Homebrew: `brew install node@22 pnpm postgresql@16`).

```
cd OSTCRM
pnpm install
ADMIN_DATABASE_URL=postgres://<your-postgres-user>@localhost:5432/postgres pnpm --filter @ostcrm/api local
# in a second Terminal window:
pnpm --filter @ostcrm/web local
```

Then open http://localhost:5173.
