import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, loadMigrations, migrateDown, migrateUp } from "../src/migrate.js";
import { freshDb, type TestDb } from "./helpers.js";

const schemaSnapshot = async (t: TestDb) => (await t.owner.query(
  `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema IN ('public', 'app') AND table_name <> 'schema_migrations'
    ORDER BY table_name, ordinal_position`)).rows;

describe("migrations", () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb({ migrate: false }); });
  afterAll(async () => { await t.drop(); });

  it("are numbered consecutively and every one has a down path", () => {
    const ms = loadMigrations();
    expect(ms.map(m => m.version)).toEqual(ms.map((_, i) => i + 1));
    expect(ms.every(m => m.down.trim().length > 0)).toBe(true);
  });

  it("apply from empty, roll all the way down, and apply again to the same schema", async () => {
    const all = loadMigrations().map(m => m.version);
    expect(await migrateUp(t.owner)).toEqual(all);
    const first = await schemaSnapshot(t);
    expect(first.length).toBeGreaterThan(200);
    expect(await migrateDown(t.owner, all.length)).toEqual([...all].reverse());
    const tables = await t.owner.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations'");
    expect(tables.rows[0].n).toBe(0);
    expect(await migrateUp(t.owner)).toEqual(all);
    expect(await schemaSnapshot(t)).toEqual(first);
  });

  it("is a no-op when up to date", async () => {
    expect(await migrateUp(t.owner)).toEqual([]);
  });

  it("refuses to run if an applied migration was edited", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    for (const f of readdirSync(MIGRATIONS_DIR)) writeFileSync(join(dir, f), readFileSync(join(MIGRATIONS_DIR, f)));
    writeFileSync(join(dir, "0002_business.up.sql"), readFileSync(join(dir, "0002_business.up.sql"), "utf8") + "\n-- edited\n");
    await expect(migrateUp(t.owner, loadMigrations(dir))).rejects.toThrow(/edited after it ran/);
  });

  it("rejects a migration with no down path or a gap in numbering", () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    writeFileSync(join(dir, "0001_a.up.sql"), "SELECT 1");
    expect(() => loadMigrations(dir)).toThrow(/no down path/);
    writeFileSync(join(dir, "0001_a.down.sql"), "SELECT 1");
    writeFileSync(join(dir, "0003_c.up.sql"), "SELECT 1");
    writeFileSync(join(dir, "0003_c.down.sql"), "SELECT 1");
    expect(() => loadMigrations(dir)).toThrow(/consecutively/);
  });

  it("rolls back a failing migration completely", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    for (const f of readdirSync(MIGRATIONS_DIR)) writeFileSync(join(dir, f), readFileSync(join(MIGRATIONS_DIR, f)));
    const n = String(loadMigrations().length + 1).padStart(4, "0");
    writeFileSync(join(dir, `${n}_broken.up.sql`), "CREATE TABLE half_done (x int); SELECT 1/0;");
    writeFileSync(join(dir, `${n}_broken.down.sql`), "DROP TABLE IF EXISTS half_done;");
    await expect(migrateUp(t.owner, loadMigrations(dir))).rejects.toThrow(/broken failed/);
    const r = await t.owner.query("SELECT to_regclass('half_done') AS t");
    expect(r.rows[0].t).toBeNull();
  });
});
