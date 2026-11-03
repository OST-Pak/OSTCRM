import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, attempt, code, freshDb, seedPeople, type TestDb } from "./helpers.js";

let t: TestDb;
let P: Awaited<ReturnType<typeof seedPeople>>;
let companyId: string;
let dealId: string;

beforeAll(async () => {
  t = await freshDb();
  P = await seedPeople(t.owner);
  companyId = (await t.owner.query("INSERT INTO companies (name, name_normalized, domain) VALUES ('Acme PEO', 'acme', 'acmepeo.com') RETURNING id")).rows[0].id;
  dealId = (await t.owner.query("INSERT INTO deals (company_id, stage, owner_id) VALUES ($1, 'Contacted', $2) RETURNING id", [companyId, P.specialist])).rows[0].id;
});
afterAll(async () => { await t.drop(); });

describe("standard columns", () => {
  it("ids are UUID v7 and time-ordered", async () => {
    const r = await t.owner.query("SELECT app.uuid_v7()::text AS a, pg_sleep(0.002), app.uuid_v7()::text AS b");
    expect(r.rows[0].a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(r.rows[0].a < r.rows[0].b).toBe(true);
  });

  it("every business table has the standard columns", async () => {
    const r = await t.owner.query(`
      SELECT c.table_name FROM information_schema.tables c
       WHERE c.table_schema = 'public' AND c.table_type = 'BASE TABLE'
         AND c.table_name NOT IN ('schema_migrations', 'audit_log', 'ai_runs', 'errors', 'outbox', 'idempotency_keys',
                                  'activities', 'deal_stage_events', 'proposal_versions')
         AND (SELECT count(*) FROM information_schema.columns k WHERE k.table_name = c.table_name AND k.table_schema = 'public'
              AND k.column_name IN ('id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version', 'archived_at')) <> 7`);
    expect(r.rows).toEqual([]);
  });

  it("updates bump the version and a stale version updates nothing", async () => {
    await as(t.app, P.bd_support, "bd_support", async db => {
      const before = (await db.query("SELECT version FROM companies WHERE id = $1", [companyId])).rows[0].version;
      const ok = await db.query("UPDATE companies SET state = 'Ohio' WHERE id = $1 AND version = $2", [companyId, before]);
      expect(ok.rowCount).toBe(1);
      const stale = await db.query("UPDATE companies SET state = 'Texas' WHERE id = $1 AND version = $2", [companyId, before]);
      expect(stale.rowCount).toBe(0);
      const row = (await db.query("SELECT version, updated_by FROM companies WHERE id = $1", [companyId])).rows[0];
      expect(row).toEqual({ version: before + 1, updated_by: P.bd_support });
    });
  });

  it("created_by defaults to the signed-in person and cannot be rewritten", async () => {
    await as(t.app, P.bd_support, "bd_support", async db => {
      const id = (await db.query("INSERT INTO tasks (title) VALUES ('Call back') RETURNING id, created_by")).rows[0];
      expect(id.created_by).toBe(P.bd_support);
      await db.query("UPDATE tasks SET created_by = $1 WHERE id = $2", [P.owner, id.id]);
      expect((await db.query("SELECT created_by FROM tasks WHERE id = $1", [id.id])).rows[0].created_by).toBe(P.bd_support);
    });
  });
});

describe("integrity", () => {
  it("companies are unique on domain, except a marked duplicate", async () => {
    expect(await code(t.owner.query("INSERT INTO companies (name, name_normalized, domain) VALUES ('Acme 2', 'acme 2', 'acmepeo.com')"))).toBe("23505");
    expect(await code(t.owner.query("INSERT INTO companies (name, name_normalized, domain, duplicate_of) VALUES ('Acme alias', 'acme alias', 'acmepeo.com', $1)", [companyId]))).toBe("ok");
  });

  it("domains and emails must already be normalized", async () => {
    expect(await code(t.owner.query("INSERT INTO companies (name, name_normalized, domain) VALUES ('X', 'x', 'X.com')"))).toBe("23514");
    expect(await code(t.owner.query("INSERT INTO contacts (company_id, name, email) VALUES ($1, 'Jane', 'Jane@x.com')", [companyId]))).toBe("23514");
  });

  it("contacts are unique on email", async () => {
    await t.owner.query("INSERT INTO contacts (company_id, name, email) VALUES ($1, 'Jane', 'jane@acmepeo.com')", [companyId]);
    expect(await code(t.owner.query("INSERT INTO contacts (company_id, name, email) VALUES ($1, 'Jane B', 'jane@acmepeo.com')", [companyId]))).toBe("23505");
  });

  it("one open deal per company and offer; closed deals do not count", async () => {
    expect(await code(t.owner.query("INSERT INTO deals (company_id, stage) VALUES ($1, 'Replied')", [companyId]))).toBe("23505");
    expect(await code(t.owner.query("INSERT INTO deals (company_id, stage, offer) VALUES ($1, 'Replied', '30-day pilot')", [companyId]))).toBe("ok");
    expect(await code(t.owner.query("INSERT INTO deals (company_id, stage) VALUES ($1, 'Lost')", [companyId]))).toBe("ok");
  });

  it("activities, stage events and the audit log are append-only, even for the table owner", async () => {
    const a = (await t.owner.query("INSERT INTO activities (company_id, type, occurred_on) VALUES ($1, 'Call', '2026-11-10') RETURNING id", [companyId])).rows[0].id;
    expect(await code(t.owner.query("UPDATE activities SET summary = 'x' WHERE id = $1", [a]))).toBe("42501");
    expect(await code(t.owner.query("DELETE FROM activities WHERE id = $1", [a]))).toBe("42501");
    expect(await code(t.owner.query("UPDATE audit_log SET action = 'x'"))).toBe("42501");
    expect(await code(t.owner.query("DELETE FROM audit_log"))).toBe("42501");
  });

  it("proposal versions are immutable, except filling in the PDF once", async () => {
    const p = (await t.owner.query("INSERT INTO proposals (company_id, number) VALUES ($1, 'OST-2611-001') RETURNING id", [companyId])).rows[0].id;
    const v = (await t.owner.query("INSERT INTO proposal_versions (proposal_id, v, snapshot, monthly_cents) VALUES ($1, 1, '{}', 440000) RETURNING id", [p])).rows[0].id;
    expect(await code(t.owner.query("UPDATE proposal_versions SET monthly_cents = 1 WHERE id = $1", [v]))).toBe("42501");
    const sha = "a".repeat(64);
    expect(await code(t.owner.query("UPDATE proposal_versions SET pdf_blob_path = 'p/1.pdf', pdf_sha256 = $2 WHERE id = $1", [v, sha]))).toBe("ok");
    expect(await code(t.owner.query("UPDATE proposal_versions SET pdf_blob_path = 'p/2.pdf' WHERE id = $1", [v]))).toBe("42501");
    expect(await code(t.owner.query("DELETE FROM proposal_versions WHERE id = $1", [v]))).toBe("42501");
  });

  it("config rows are effective-dated with one current row", async () => {
    await t.owner.query("INSERT INTO config_pricing (staff_seat_cents, manager_seat_cents, effective_from) VALUES (220000, 320000, '2026-10-29')");
    expect(await code(t.owner.query("INSERT INTO config_pricing (staff_seat_cents, manager_seat_cents) VALUES (1, 1)"))).toBe("23505");
    await t.owner.query("UPDATE config_pricing SET effective_to = '2027-01-01' WHERE effective_to IS NULL");
    expect(await code(t.owner.query("INSERT INTO config_pricing (staff_seat_cents, manager_seat_cents, effective_from) VALUES (230000, 330000, '2027-01-01')"))).toBe("ok");
  });

  it("a person has one live role", async () => {
    expect(await code(t.owner.query("INSERT INTO role_assignments (user_id, role, reason) VALUES ($1, 'admin', 'x')", [P.read_only]))).toBe("23505");
  });
});

describe("audit trigger", () => {
  it("records create, update with only the changed fields, and archive, stamped with the actor", async () => {
    await t.app.query("BEGIN");
    try {
      await t.app.query(`SELECT set_config('app.user_id', $1, true), set_config('app.role', 'bd_support', true),
                         set_config('app.request_id', 'req-1', true), set_config('app.ip', '203.0.113.9', true)`, [P.bd_support]);
      const id = (await t.app.query("INSERT INTO companies (name, name_normalized) VALUES ('Beta PEO', 'beta') RETURNING id")).rows[0].id;
      await t.app.query("UPDATE companies SET state = 'Ohio' WHERE id = $1", [id]);
      await t.app.query("UPDATE companies SET archived_at = now() WHERE id = $1", [id]);
      await t.app.query("COMMIT");
      const log = (await t.owner.query("SELECT action, actor_type, actor_id, request_id, host(ip) AS ip, before, after FROM audit_log WHERE entity = 'companies' AND entity_id = $1 ORDER BY id", [id])).rows;
      expect(log.map(r => r.action)).toEqual(["create", "update", "archive"]);
      expect(log[0]).toMatchObject({ actor_type: "person", actor_id: P.bd_support, request_id: "req-1", ip: "203.0.113.9" });
      expect(log[1].before).toEqual({ state: null });
      expect(log[1].after).toEqual({ state: "Ohio" });
    } catch (e) { await t.app.query("ROLLBACK"); throw e; }
  });

  it("app users cannot write the audit log directly, and log_event stamps the real actor", async () => {
    await as(t.app, P.bd_support, "bd_support", async db => {
      expect(await attempt(db, "INSERT INTO audit_log (actor_type, action, entity) VALUES ('person', 'create', 'x')")).toBe("42501");
      await db.query("SELECT app.log_event('export', 'companies', NULL, '{\"rows\": 12}')");
      expect(await attempt(db, "SELECT app.log_event('update', 'companies', NULL)")).toBe("22023");
    });
  });
});

describe("row-level security", () => {
  it("nobody reads anything without a signed-in role", async () => {
    await t.app.query("BEGIN");
    try {
      expect((await t.app.query("SELECT count(*)::int AS n FROM companies")).rows[0].n).toBe(0);
    } finally { await t.app.query("ROLLBACK"); }
  });

  it("read only can read the pipeline but cannot write anything", async () => {
    await as(t.app, P.read_only, "read_only", async db => {
      expect((await db.query("SELECT count(*)::int AS n FROM companies")).rows[0].n).toBeGreaterThan(0);
      expect(await attempt(db, "INSERT INTO companies (name, name_normalized) VALUES ('Z', 'z')")).toBe("42501");
      expect((await db.query("UPDATE companies SET state = 'Utah' WHERE id = $1", [companyId])).rowCount).toBe(0);
      expect(await attempt(db, "INSERT INTO activities (company_id, type, occurred_on) VALUES ($1, 'Call', '2026-11-10')", [companyId])).toBe("42501");
      expect(await attempt(db, "INSERT INTO tasks (title) VALUES ('x')")).toBe("42501");
    });
  });

  it("read only does not see proposals; specialists see but cannot change them", async () => {
    await as(t.app, P.read_only, "read_only", async db => {
      expect((await db.query("SELECT count(*)::int AS n FROM proposals")).rows[0].n).toBe(0);
      expect((await db.query("SELECT count(*)::int AS n FROM proposal_versions")).rows[0].n).toBe(0);
    });
    await as(t.app, P.specialist, "specialist", async db => {
      expect((await db.query("SELECT count(*)::int AS n FROM proposals")).rows[0].n).toBeGreaterThan(0);
      expect(await attempt(db, "INSERT INTO proposals (company_id, number) VALUES ($1, 'OST-X')", [companyId])).toBe("42501");
    });
  });

  it("a specialist changes only deals assigned to them, and cannot edit companies", async () => {
    await as(t.app, P.specialist, "specialist", async db => {
      expect((await db.query("UPDATE deals SET next_step = 'Call' WHERE id = $1", [dealId])).rowCount).toBe(1);
      const other = (await t.owner.query("SELECT id FROM deals WHERE id <> $1 LIMIT 1", [dealId])).rows[0].id;
      expect((await db.query("UPDATE deals SET next_step = 'Call' WHERE id = $1", [other])).rowCount).toBe(0);
      expect((await db.query("UPDATE companies SET state = 'Utah' WHERE id = $1", [companyId])).rowCount).toBe(0);
      expect(await attempt(db, "INSERT INTO activities (company_id, type, occurred_on) VALUES ($1, 'Call', '2026-11-10')", [companyId])).toBe("ok");
    });
  });

  it("an activity cannot be logged in someone else's name: the database stamps the real author", async () => {
    await as(t.app, P.bd_support, "bd_support", async db => {
      const r = await db.query("INSERT INTO activities (company_id, type, occurred_on, created_by) VALUES ($1, 'Call', '2026-11-10', $2) RETURNING created_by", [companyId, P.owner]);
      expect(r.rows[0].created_by).toBe(P.bd_support);
    });
  });

  it("only admin and owner change config; only the owner changes roles", async () => {
    await as(t.app, P.bd_support, "bd_support", async db => {
      expect(await attempt(db, "INSERT INTO config_offers (name) VALUES ('New offer')")).toBe("42501");
    });
    await as(t.app, P.admin, "admin", async db => {
      expect(await attempt(db, "INSERT INTO config_offers (name) VALUES ('New offer')")).toBe("ok");
      expect(await attempt(db, "INSERT INTO role_assignments (user_id, role, reason) VALUES ($1, 'admin', 'x')", [P.bd_support])).toBe("42501");
    });
    await as(t.app, P.owner, "owner", async db => {
      await db.query("UPDATE role_assignments SET archived_at = now() WHERE user_id = $1 AND archived_at IS NULL", [P.read_only]);
      expect(await attempt(db, "INSERT INTO role_assignments (user_id, role, reason) VALUES ($1, 'specialist', 'Joining calls')", [P.read_only])).toBe("ok");
    });
  });

  it("people see only their own role unless they are owner or admin", async () => {
    await as(t.app, P.bd_support, "bd_support", async db => {
      const r = (await db.query("SELECT user_id FROM role_assignments")).rows;
      expect(r).toEqual([{ user_id: P.bd_support }]);
    });
  });

  it("the audit log is readable by owner and admin only", async () => {
    await as(t.app, P.bd_support, "bd_support", async db => {
      expect((await db.query("SELECT count(*)::int AS n FROM audit_log")).rows[0].n).toBe(0);
    });
    await as(t.app, P.admin, "admin", async db => {
      expect((await db.query("SELECT count(*)::int AS n FROM audit_log")).rows[0].n).toBeGreaterThan(0);
    });
  });

  it("only the owner purges, and only records archived more than 90 days ago", async () => {
    const old = (await t.owner.query("INSERT INTO tasks (title, archived_at) VALUES ('old', now() - interval '91 days') RETURNING id")).rows[0].id;
    const recent = (await t.owner.query("INSERT INTO tasks (title, archived_at) VALUES ('recent', now() - interval '10 days') RETURNING id")).rows[0].id;
    await as(t.app, P.admin, "admin", async db => {
      expect((await db.query("DELETE FROM tasks WHERE id = $1", [old])).rowCount).toBe(0);
    });
    await as(t.app, P.owner, "owner", async db => {
      expect((await db.query("DELETE FROM tasks WHERE id = $1", [recent])).rowCount).toBe(0);
      expect((await db.query("DELETE FROM tasks WHERE id = $1", [old])).rowCount).toBe(1);
    });
  });

  it("idempotency keys are private to each person", async () => {
    await t.owner.query("INSERT INTO idempotency_keys (user_id, key, route, request_hash) VALUES ($1, 'k-12345678', 'POST /x', 'h')", [P.owner]);
    await as(t.app, P.bd_support, "bd_support", async db => {
      expect((await db.query("SELECT count(*)::int AS n FROM idempotency_keys")).rows[0].n).toBe(0);
    });
  });

  it("only the worker reads and publishes the outbox", async () => {
    await as(t.app, P.owner, "owner", async db => {
      expect(await attempt(db, "INSERT INTO outbox (topic, payload) VALUES ('deal.moved', '{}')")).toBe("ok");
      expect((await db.query("SELECT count(*)::int AS n FROM outbox")).rows[0].n).toBe(0);
    });
    await as(t.worker, null, "system", async db => {
      await db.query("INSERT INTO outbox (topic, payload) VALUES ('deal.moved', '{}')");
      expect((await db.query("UPDATE outbox SET published_at = now() WHERE published_at IS NULL")).rowCount).toBeGreaterThan(0);
    });
  });
});
