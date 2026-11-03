# Decision log

Choices that change behaviour, newest first. Each entry: date, decision, who decided, why.

| Date | Decision | Decided by | Why |
|---|---|---|---|
| 2026-11-02 | Migrations are hand-written SQL with a down script each, run by our own small runner. Drizzle is added with the API for typed queries only. | Claude | Drizzle Kit does not generate down migrations; the brief requires a down path for every migration. |
| 2026-11-02 | The audit log is written by a database trigger on every business table, in the same transaction as the change. Reads, exports and sign-ins are logged by the API through `app.log_event`, which stamps the real actor. | Claude | No code path, including a bug or a direct query by the app role, can change data without an audit row. |
| 2026-11-02 | Known duplicates load as their own company with `duplicate_of` set; the unique-domain rule skips them. | Claude | Default for open decision 12 until Saad decides. |
| 2026-11-02 | Blocked client names for the proposal validator live in a config table, not in code or tests. Tests use a fictional name. | Claude | Keeps client names out of the repository. |
| 2026-11-02 | Proposals are not sent from the CRM. Saad downloads the PDF, sends it himself and marks it sent. The CRM tracks due dates for proposals and contracts. The brief's `proposal.send` permission becomes `proposal.markSent`. | Saad | Earlier artifact decision; the brief predates it. |
| 2026-11-02 | Proposal terms: minimum term 1 year, then 90 days' written notice; billed monthly in advance. | Saad | Standard terms for the template. |
| 2026-11-02 | Three duplicate company pairs stay as separate records, shown as a parent with the duplicate underneath, not merged. | Saad | Merge decision deferred. See open decision 12. |
| 2026-11-02 | Where the build-instructions doc is not in the session, domain rules are ported from the live artifact's code as of version 30. Each ported constant lives in `packages/domain/src/defaults.ts` and becomes an owner-editable config row at migration. | Claude | The brief says to port behaviour. Saad to confirm against the build-instructions doc. |
| 2026-11-02 | Hosting is Azure. | Saad | Team already uses Microsoft 365. |
| 2026-11-02 | Monthly AI spend cap $500, alerts at 80%, 85%, 90%, 95% and 100%. | Saad | From the brief. |
