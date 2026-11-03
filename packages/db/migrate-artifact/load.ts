import type { ClientBase } from "pg";
import type { Row, Transformed } from "./types.js";

const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * Inserts rows with an explicit column list (columns a row leaves out take their defaults).
 * Rows go through jsonb_populate_recordset, so values are typed by the table and never spliced into SQL.
 */
async function insertRows(db: ClientBase, table: string, rows: Row[], chunk = 500): Promise<void> {
  if (!rows.length) return;
  if (!IDENT.test(table)) throw new Error(`Bad table name ${table}`);
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  for (const c of cols) if (!IDENT.test(c)) throw new Error(`Bad column name ${table}.${c}`);
  const list = cols.map(c => `"${c}"`).join(", ");
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    await db.query(`INSERT INTO ${table} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, [JSON.stringify(part)]);
  }
}

/**
 * Loads a transformed export in ONE transaction: either everything lands or nothing does.
 * Runs as the migrator (table owner). Audit rows written by the triggers are stamped as a system job
 * with the reason "artifact migration", plus one summary event. Refuses to load into a non-empty database.
 */
export async function loadTransformed(db: ClientBase, t: Transformed, opts: { allowNonEmpty?: boolean } = {}): Promise<Record<string, number>> {
  await db.query("BEGIN");
  try {
    await db.query(`SELECT set_config('app.actor_type', 'system', true), set_config('app.reason', 'artifact migration', true),
                           set_config('app.request_id', 'migrate-artifact', true)`);
    if (!opts.allowNonEmpty) {
      const n = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM companies")).rows[0]!.n;
      if (n > 0) throw new Error(`Target database already has ${n} companies. Load into an empty database.`);
    }
    // Triggers stay on: foreign keys and checks are enforced on every row, and each loaded record
    // gets its own audit row stamped as the migration.
    const counts: Record<string, number> = {};
    for (const [table, rows] of t.tables) {
      await insertRows(db, table, rows);
      // The audit log also gains one trigger row per loaded record; count only the imported history.
      const where = table === "audit_log" ? " WHERE action LIKE 'legacy:%'" : "";
      counts[table] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}${where}`)).rows[0]!.n;
    }
    await db.query(`INSERT INTO audit_log (actor_type, action, entity, request_id, reason, after)
                    VALUES ('system', 'migrate', 'artifact', 'migrate-artifact', 'artifact migration', $1)`,
      [JSON.stringify({ exportedAt: t.report.exportedAt, out: t.report.out, rejected: t.report.rejected.length, adjusted: t.report.adjusted.length })]);
    await db.query("COMMIT");
    return counts;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}
