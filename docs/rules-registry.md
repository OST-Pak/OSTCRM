# Rules registry coverage

Every rule in the "Business rules registry" of **Oak Street BD CRM: Build Instructions for Claude** (https://claude.ai/artifact/WehyjQuYbBNjmuuREpHD9d), mapped to the function that implements it and the tests that prove it. Go-live checklist item: "every business rule from the existing build-instructions doc has a passing unit test".

| Registry rule | Value in the doc | Function | Tests |
|---|---|---|---|
| Push window | Oct 29 to Dec 27, 2026; deadline Dec 11 | `DEFAULT_PLAN` (config_plan) | `pace.test.ts`, `forecast.test.ts` |
| Seat pricing | $2,200 staff, $3,200 manager a month | `DEFAULT_PRICING` (config_pricing), in cents | `stages.test.ts` (money) |
| Monthly value of a deal | staff × $2,200 + manager × $3,200 | `monthlyValueCents` | `stages.test.ts` (money) |
| Stages, in order | Target ... Lost | `STAGES` | `cadence.test.ts`, `registry.test.ts` |
| Open stages | Contacted through Verbal yes | `OPEN_STAGES`, `isOpenStage` | `stages.test.ts` |
| Forecast weight by stage | 2%, 5%, 10%, 20%, 35%, 70%, 100% | `STAGE_PROBABILITY`, `forecast` | `forecast.test.ts` |
| Stage time limits | 7, 2, 7, 2, 5, 5 days | `STAGE_SLA`, `dealHealth` | `stages.test.ts` (on the limit is fine, one day over is red) |
| Deal health: red | No next step; overdue; over limit; no decision date from Proposal sent | `dealHealth` | `stages.test.ts` |
| Deal health: amber | No activity, or no touch in 5+ days | `dealHealth` | `stages.test.ts` |
| Save validation | Name; next step and date; value or seats; seats when signed; reason when lost | `validateDealSave` | `registry.test.ts` |
| Stage auto-advance | Proposal sent, Meeting held, Meeting booked, positive reply, first outbound; never Signed or Lost; never backwards | `nextStage`, `needsNextStep` | `registry.test.ts` |
| Weekly targets | 15, 5, 300 from Nov 9, 150, 3, 4 from Nov 9, 2 from Nov 16 | `DEFAULT_WEEKLY_TARGETS`, `weeklyScorecard` | `pace.test.ts` |
| Pace plan | Meetings 2/8/20, proposals 10, signed 3 by Dec 11 and 4 by Dec 27 | `DEFAULT_PLAN`, `planAt`, `paceStatus` | `pace.test.ts` |
| Proposals | Versioned; sent version locked; revision after sending is a new proposal | `canAddProposalVersion`, `proposal_versions` guard | `registry.test.ts`, db `rules.test.ts` |
| Import duplicates | Contacts by email; companies by domain plus normalized name | `importMatcher` | `registry.test.ts` |
| Activity effects | Auto-advance, first proposal date, next step carried; open deal needs a next step not in the past | `activityEffect` | `deal.test.ts`, api `company.test.ts` |
| Stage dates on save | Stage date stamped on change; signed date set once, cleared if moved back | `stageDatesOnSave` | `deal.test.ts`, api `company.test.ts` |
| Cadence | Steps per stage, due from the stage date; ticks per stage; Proposal step done by sending | `cadenceFor`, `cadenceTick` | `cadence.test.ts`, `pipeline.test.ts`, api `board.test.ts` |
| Documents due | Proposal 2 days after discovery; contract 1 day after verbal yes; signature 3 days after the contract; decision 5 days after the proposal | `documentDue`, `documentsDue`, `signatureDueAfter` | `cadence.test.ts`, `pipeline.test.ts`, api `board.test.ts` |
| Pipeline board | Open and signed deals by stage, sorted by next step due; value at founding prices | `pipelineBoard` | `pipeline.test.ts`, api `board.test.ts` |
| Tiers | Score, rank; top 40 A, next 160 B; partners, clients, unfit, closed and duplicates excluded | `tierScore`, `assignTiers`, `rankProspects` | `accounts.test.ts`, `prospects.test.ts`, api `api.test.ts` |

Rules the doc describes elsewhere, also covered:

| Rule | Function or control | Tests |
|---|---|---|
| Save only changed fields; detect someone else's edit | Version column, 409 conflict | db `rules.test.ts`, api `api.test.ts` |
| Related writes succeed or fail together | One transaction per request | api `api.test.ts` |
| Archive instead of delete; no orphans | `archived_at`, cascade archive, owner-only purge | db `rules.test.ts`, api `api.test.ts` |
| No silent caps | Cursor paging | api `api.test.ts` |
| Errors logged with who, where, request id | `errors` table | api `api.test.ts` |
| Identity from the signed-in account | Entra token, `app.resolve_user`, database role lookup | api `api.test.ts`, db `hardening.test.ts` |

Not yet covered (later phases): the AI pace review checks and its snapshot test set (phase 3).
