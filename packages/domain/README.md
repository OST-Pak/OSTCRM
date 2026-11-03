# @ostcrm/domain

Pure business rules: no I/O, no clock, no globals. Every function takes "today" and its config as arguments, so the same inputs always give the same scorecard, pace and stage outcomes.

Ported from the live artifact CRM (version 30, Nov 2, 2026). Values in `src/defaults.ts` are the artifact's current settings and become owner-editable config rows at migration.

| Module | Rules |
|---|---|
| `dates` | UTC date maths, Monday weeks, working days |
| `stages` | Open stages, stage start, touch counts, last touch, deal health (red/amber reasons) |
| `money` | Monthly value in cents from seats and list prices |
| `pace` | Plan interpolation, actuals, pace status |
| `scorecard` | Weekly scorecard rules and pro-rated status |
| `forecast` | Measured funnel, measured-or-assumed rates, weighted forecast and what it takes to close the gap |
| `cadence` | Cadence steps per stage; proposal, contract, decision and signature due dates |
| `accounts` | Domain and name normalization, buying-committee coverage, staleness, triggers, tiering, Enwage flag |
| `proposal` | Proposal totals, placeholders, validation including the client-name block |

Not ported yet (need data that lives outside the artifact database; see open decisions 14 and 15): resolving a company's type, platform, size and research priority from the embedded research seed data.

`pnpm test` runs the suite with coverage thresholds (90% lines).
