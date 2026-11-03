# Decision log

Choices that change behaviour, newest first. Each entry: date, decision, who decided, why.

| Date | Decision | Decided by | Why |
|---|---|---|---|
| 2026-11-02 | Open decision 12 closed: the three duplicate pairs stay linked, not merged. The second record of each pair loads with `duplicate_of` set, shows under the main record, has no deal of its own and stays out of lists and tiering. They can be merged later. | Saad | Merging can be done later; un-merging cannot be done cleanly. |
| 2026-11-02 | Open decision 18 closed: BD support can see and edit proposals, including pricing, and mark them sent, as the brief says. | Saad | Follows the brief's role table. |
| 2026-11-02 | The database looks up each person's role itself and ignores the role the caller claims. The worker gets the `system` role only through its own login in `app_worker`. | Claude | Independent security review: a caller could otherwise claim any role. |
| 2026-11-02 | Admins cannot change sign-in identities or touch the owner's account. Specialists cannot create deals, move a deal to another company, or log stage events or deal activities on others' deals. | Claude | Independent security review findings 1 and 2. |
| 2026-11-02 | The API accepts only Entra v2 access tokens carrying the `access_as_user` scope; ID tokens are refused. Engineer A sets the audience to the App ID URI. | Claude | Independent security review finding 8. |
| 2026-11-02 | Queries use parameterized SQL through `pg`, not Drizzle, for now. | Claude | Fewer moving parts while row-level security and transaction context are being proven. Revisit when the number of queries grows. |
| 2026-11-02 | Specialists can move and edit deals assigned to them but cannot edit company records. The API returns 403 for both cases; the database blocks them as a second layer. | Claude | The brief's role table gives Specialists activity logging, tasks and viewing proposals, plus row-scoped deal edits. |
| 2026-11-02 | The brief's `proposal.send` permission is `proposal.markSent`. | Saad | Proposals are sent outside the CRM. |
| 2026-11-02 | A company gets a `deals` row at migration if it is past Target or has seats or a next step. Duplicates do not get their own deal. | Claude | The artifact kept the deal on the company; Target-only prospects have no deal yet. |
| 2026-11-02 | The migration loads with all triggers on, so every loaded record gets an audit row marked "artifact migration". | Claude | Keeps foreign keys enforced and gives every record a provenance entry. |
| 2026-11-02 | Staging dry runs use an export masked with `migrate-artifact mask` (names, contact details and free text replaced; audit trail removed). | Claude | Default for open decision 11. |
| 2026-11-02 | Migrations are hand-written SQL with a down script each, run by our own small runner. Drizzle is added with the API for typed queries only. | Claude | Drizzle Kit does not generate down migrations; the brief requires a down path for every migration. |
| 2026-11-02 | The audit log is written by a database trigger on every business table, in the same transaction as the change. Reads, exports and sign-ins are logged by the API through `app.log_event`, which stamps the real actor. | Claude | No code path, including a bug or a direct query by the app role, can change data without an audit row. |
| 2026-11-02 | Blocked client names for the proposal validator live in a config table, not in code or tests. Tests use a fictional name. | Claude | Keeps client names out of the repository. |
| 2026-11-02 | Proposals are not sent from the CRM. Saad downloads the PDF, sends it himself and marks it sent. The CRM tracks due dates for proposals and contracts. The brief's `proposal.send` permission becomes `proposal.markSent`. | Saad | Earlier artifact decision; the brief predates it. |
| 2026-11-02 | Proposal terms: minimum term 1 year, then 90 days' written notice; billed monthly in advance. | Saad | Standard terms for the template. |
| 2026-11-02 | Three duplicate company pairs stay as separate records, shown as a parent with the duplicate underneath, not merged. | Saad | Merge decision deferred. See open decision 12. |
| 2026-11-02 | Where the build-instructions doc is not in the session, domain rules are ported from the live artifact's code as of version 30. Each ported constant lives in `packages/domain/src/defaults.ts` and becomes an owner-editable config row at migration. | Claude | The brief says to port behaviour. Saad to confirm against the build-instructions doc. |
| 2026-11-02 | Hosting is Azure. | Saad | Team already uses Microsoft 365. |
| 2026-11-02 | Monthly AI spend cap $500, alerts at 80%, 85%, 90%, 95% and 100%. | Saad | From the brief. |
