# Run the CRM on your own computer (local preview)

It shows demo data (fictional companies) until you add your own export, below. Sign-in is a "choose who you are" picker, because Microsoft sign-in needs the Azure app registration. Nothing here talks to the live CRM.

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

## See your real CRM data

1. Open the current CRM (the artifact), go to **Access**, click **Export all data** and confirm. A file named like `oak-street-crm-export-2026-11-03.json` downloads.
2. In the OSTCRM folder, make a folder called `local-data` and move that file into it.
3. Start the preview as above. The first start loads the file into its own local database (`ostcrm_local_real`, separate from the demo one) and the log shows `Your CRM export loaded: N companies...`. A reconciliation report is written to `local-data/import-report.md`.
4. The sign-in picker now lists your team with their roles from the CRM's Access screen. Saad is Owner.

The file is your production data. It stays on your computer: `local-data/` is ignored by git and kept out of the Docker image. Do not email or upload it.

The data is a copy taken when you exported. Changes in the live CRM do not appear here, and changes here do not go back. To refresh it, put a newer export in `local-data/` and reset the database (Docker: `docker compose -f docker-compose.local.yml down -v`; without Docker: `dropdb ostcrm_local_real`), then start again. If there are several exports in the folder, the newest name is used.

Screens: Prospects shows everything. The other screens are still being ported and say so.
