import type { ReconciliationReport } from "./types.js";

/** The reconciliation report as Markdown, for the dry-run record Engineer B files. */
export function reportMarkdown(r: ReconciliationReport, loaded?: Record<string, number>): string {
  const L: string[] = [];
  L.push(`# Artifact migration reconciliation`, ``, `Export taken ${r.exportedAt}.`, ``);
  L.push(`## Records in and out`, ``, `| Artifact collection | In |`, `|---|---|`);
  for (const [k, v] of Object.entries(r.in)) L.push(`| ${k} | ${v} |`);
  L.push(``, `| Table | Prepared |${loaded ? " Loaded |" : ""}`, `|---|---|${loaded ? "---|" : ""}`);
  for (const [k, v] of Object.entries(r.out)) L.push(`| ${k} | ${v} |${loaded ? ` ${loaded[k] ?? "–"} |` : ""}`);
  L.push(``, `## Rejected (${r.rejected.length})`, ``);
  if (r.rejected.length) { L.push(`| Collection | Record | Reason |`, `|---|---|---|`); for (const x of r.rejected) L.push(`| ${x.collection} | ${x.id} | ${x.reason} |`); } else L.push(`None.`);
  L.push(``, `## Loaded with a change (${r.adjusted.length})`, ``);
  if (r.adjusted.length) { L.push(`| Collection | Record | What changed |`, `|---|---|---|`); for (const x of r.adjusted) L.push(`| ${x.collection} | ${x.id} | ${x.note} |`); } else L.push(`None.`);
  L.push(``, `## Not migrated`, ``);
  for (const x of r.notMigrated) L.push(`- **${x.what}:** ${x.why}`);
  if (!r.notMigrated.length) L.push(`Nothing.`);
  L.push(``, `## Deals per stage`, ``, `| Stage | Deals |`, `|---|---|`);
  for (const [k, v] of Object.entries(r.dealsPerStage)) L.push(`| ${k} | ${v} |`);
  L.push(``, `## Touches per person per week`, ``, `| Person | Week of | Touches |`, `|---|---|---|`);
  for (const [k, v] of Object.entries(r.activitiesPerPersonPerWeek).sort()) { const [p, w] = k.split(" | "); L.push(`| ${p} | ${w} | ${v} |`); }
  L.push(``, `## Proposals and clients`, ``,
    `- Proposals: ${r.proposals.total} (${r.proposals.sent} sent), ${r.proposals.versions} versions`,
    `- Monthly value of sent proposals: $${Math.round(r.proposals.monthlyCentsSent / 100).toLocaleString("en-US")}`,
    `- Clients: ${r.clients}`, ``);
  return L.join("\n");
}
