/**
 * Engineer B runs this. Never on a laptop against production; never commit an export.
 *
 *   Mask for staging:   tsx migrate-artifact/cli.ts mask   <export.json> <out.json>          (MASK_SECRET env)
 *   Dry run (no DB):    tsx migrate-artifact/cli.ts report <export.json> <people.json> <report.md>
 *   Load:               tsx migrate-artifact/cli.ts load   <export.json> <people.json> <report.md>   (DATABASE_URL env)
 *
 * people.json: [{"teamName":"Saad","email":"...","displayName":"...","entraOid":"..."}, ...]
 */
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { loadTransformed } from "./load.js";
import { maskExport } from "./mask.js";
import { reportMarkdown } from "./report.js";
import { transformExport } from "./transform.js";

const [cmd, input, second, out] = process.argv.slice(2);
const readJson = (p: string | undefined) => { if (!p) throw new Error("Missing file argument"); return JSON.parse(readFileSync(p, "utf8")); };

if (cmd === "mask") {
  const secret = process.env.MASK_SECRET ?? "";
  writeFileSync(second!, JSON.stringify(maskExport(readJson(input), secret)));
  console.log(`Masked export written to ${second}`);
} else if (cmd === "report" || cmd === "load") {
  const t = transformExport(readJson(input), { people: readJson(second) });
  let loaded: Record<string, number> | undefined;
  if (cmd === "load") {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try { loaded = await loadTransformed(db, t); } finally { await db.end(); }
  }
  writeFileSync(out!, reportMarkdown(t.report, loaded));
  console.log(`${cmd === "load" ? "Loaded" : "Dry run"}: ${t.report.rejected.length} rejected, ${t.report.adjusted.length} adjusted. Report: ${out}`);
} else {
  console.error("Usage: cli.ts mask|report|load ...");
  process.exitCode = 2;
}
