# @ostcrm/web

React, TypeScript, Vite, TanStack Router and Query. One file per screen in `src/views`. The stylesheet in `src/styles/crm.css` is the live artifact's, unchanged, so the hosted app keeps the same look in light and dark themes and at phone width.

## Sign-in

Production signs in with Microsoft Entra ID through MSAL (redirect flow, session storage only) and calls the API with an access token for the `access_as_user` scope. Set at build time:

```
VITE_ENTRA_CLIENT_ID=<web app registration>
VITE_ENTRA_TENANT_ID=<tenant id>
VITE_API_SCOPE=api://<api app id uri>/access_as_user
```

## Checks

- `pnpm --filter @ostcrm/web test`: component tests.
- `TEST_DATABASE_URL=... pnpm --filter @ostcrm/web e2e`: builds the app in e2e mode, starts the real API on a throwaway database with a fake Entra tenant and synthetic demo data, and runs `e2e/checks/*.mjs` in Chromium. Screenshots for review go to `e2e/out`. The e2e sign-in path exists only in `--mode e2e` builds; production bundles do not contain it. Needs Playwright 1.63 with Chromium installed.
