/**
 * One test per finding from the independent security review of the schema and API (see PR description).
 * Each reproduces the attack the reviewer demonstrated and checks it now fails.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, attempt, freshDb, seedPeople, type TestDb } from "./helpers.js";

let t: TestDb;
let P: Awaited<ReturnType<typeof seedPeople>>;
let co1: string, co2: string, ownDeal: string, otherDeal: string;

beforeAll(async () => {
  t = await freshDb();
  P = await seedPeople(t.owner);
  for (const r of Object.keys(P) as (keyof typeof P)[]) await t.owner.query("UPDATE users SET entra_oid = $2 WHERE id = $1", [P[r], `oid-${r}`]);
  co1 = (await t.owner.query("INSERT INTO companies (name, name_normalized) VALUES ('One', 'one') RETURNING id")).rows[0].id;
  co2 = (await t.owner.query("INSERT INTO companies (name, name_normalized) VALUES ('Two', 'two') RETURNING id")).rows[0].id;
  ownDeal = (await t.owner.query("INSERT INTO deals (company_id, stage, owner_id) VALUES ($1, 'Contacted', $2) RETURNING id", [co1, P.specialist])).rows[0].id;
  otherDeal = (await t.owner.query("INSERT INTO deals (company_id, stage, owner_id) VALUES ($1, 'Contacted', $2) RETURNING id", [co2, P.bd_support])).rows[0].id;
});
afterAll(async () => { await t.drop(); });

describe("the database does not trust the role the caller sends", () => {
  it("claiming owner while signed in as Read only gets Read only", async () => {
    await as(t.app, P.read_only, "owner", async db => {
      expect((await db.query("SELECT app.current_role() AS r")).rows[0].r).toBe("read_only");
      expect(await attempt(db, "INSERT INTO config_offers (name) VALUES ('x')")).toBe("42501");
    });
  });

  it("claiming system from the API's login gets nothing; only the worker login is system", async () => {
    await as(t.app, null, "system", async db => {
      expect((await db.query("SELECT app.current_role() AS r")).rows[0].r).toBe("none");
      expect((await db.query("SELECT count(*)::int AS n FROM companies")).rows[0].n).toBe(0);
    });
    await as(t.worker, null, "system", async db => {
      expect((await db.query("SELECT app.current_role() AS r")).rows[0].r).toBe("system");
    });
  });

  it("a disabled person has no role, whatever is claimed", async () => {
    await t.owner.query("UPDATE users SET disabled_at = now() WHERE id = $1", [P.read_only]);
    await as(t.app, P.read_only, "read_only", async db => {
      expect((await db.query("SELECT count(*)::int AS n FROM companies")).rows[0].n).toBe(0);
    });
    await t.owner.query("UPDATE users SET disabled_at = NULL WHERE id = $1", [P.read_only]);
  });

  it("sign-in lookup works without broad read rights", async () => {
    const r = await t.app.query("SELECT * FROM app.resolve_user('oid-bd_support')");
    expect(r.rows[0]).toMatchObject({ id: P.bd_support, role: "bd_support", disabled: false });
  });
});

describe("finding 1: admin cannot take over or lock out the owner", () => {
  it("admin cannot move a sign-in identity", async () => {
    await as(t.app, P.admin, "admin", async db => {
      expect(await attempt(db, "UPDATE users SET entra_oid = NULL WHERE id = $1", [P.admin])).toBe("42501");
      expect(await attempt(db, "UPDATE users SET entra_oid = 'oid-admin' WHERE id = $1", [P.owner])).toBe("42501");
    });
  });

  it("admin cannot disable, archive or edit the owner account", async () => {
    await as(t.app, P.admin, "admin", async db => {
      expect(await attempt(db, "UPDATE users SET disabled_at = now() WHERE id = $1", [P.owner])).toBe("42501");
      expect(await attempt(db, "UPDATE users SET archived_at = now() WHERE id = $1", [P.owner])).toBe("42501");
      expect(await attempt(db, "UPDATE users SET display_name = 'x' WHERE id = $1", [P.owner])).toBe("42501");
      expect(await attempt(db, "UPDATE users SET display_name = 'BD' WHERE id = $1", [P.bd_support])).toBe("ok");
    });
  });

  it("the owner can still manage identities", async () => {
    await as(t.app, P.owner, "owner", async db => {
      expect(await attempt(db, "UPDATE users SET entra_oid = 'oid-new' WHERE id = $1", [P.specialist])).toBe("ok");
    });
  });
});

describe("finding 2: Specialist scope", () => {
  it("cannot create deals or move or reassign their own", async () => {
    await as(t.app, P.specialist, "specialist", async db => {
      expect(await attempt(db, "INSERT INTO deals (company_id, stage, offer, owner_id) VALUES ($1, 'Contacted', 'x', $2)", [co2, P.specialist])).toBe("42501");
      expect(await attempt(db, "UPDATE deals SET company_id = $2 WHERE id = $1", [ownDeal, co2])).toBe("42501");
      expect(await attempt(db, "UPDATE deals SET next_step = 'Call' WHERE id = $1", [ownDeal])).toBe("ok");
    });
  });

  it("cannot write stage events or deal activities on someone else's deal", async () => {
    await as(t.app, P.specialist, "specialist", async db => {
      expect(await attempt(db, "INSERT INTO deal_stage_events (deal_id, to_stage, changed_on) VALUES ($1, 'Replied', '2026-11-10')", [otherDeal])).toBe("42501");
      expect(await attempt(db, "INSERT INTO deal_stage_events (deal_id, to_stage, changed_on) VALUES ($1, 'Replied', '2026-11-10')", [ownDeal])).toBe("ok");
      expect(await attempt(db, "INSERT INTO activities (company_id, deal_id, type, occurred_on) VALUES ($1, $2, 'Call', '2026-11-10')", [co2, otherDeal])).toBe("42501");
      expect(await attempt(db, "INSERT INTO activities (company_id, type, occurred_on) VALUES ($1, 'Call', '2026-11-10')", [co2])).toBe("ok");
    });
  });
});

describe("finding 3: authors cannot be forged", () => {
  it("created_by and updated_by are stamped by the database", async () => {
    await as(t.app, P.specialist, "specialist", async db => {
      const e = await db.query("INSERT INTO deal_stage_events (deal_id, to_stage, changed_on, created_by) VALUES ($1, 'Replied', '2026-11-10', $2) RETURNING created_by", [ownDeal, P.owner]);
      expect(e.rows[0].created_by).toBe(P.specialist);
    });
    await as(t.app, P.bd_support, "bd_support", async db => {
      const c = await db.query("INSERT INTO companies (name, name_normalized, created_by, updated_by) VALUES ('F', 'f', $1, $1) RETURNING created_by, updated_by", [P.owner]);
      expect(c.rows[0]).toEqual({ created_by: P.bd_support, updated_by: P.bd_support });
      const u = await db.query("UPDATE companies SET state = 'Ohio', updated_by = $2 WHERE id = $1 RETURNING updated_by", [co1, P.owner]);
      expect(u.rows[0].updated_by).toBe(P.bd_support);
    });
  });

  it("the migration loader, which runs with no role, keeps the authors it was given", async () => {
    const r = await t.owner.query("INSERT INTO companies (name, name_normalized, created_by) VALUES ('Legacy', 'legacy', $1) RETURNING created_by", [P.admin]);
    expect(r.rows[0].created_by).toBe(P.admin);
  });
});

describe("finding 4: AI runs keep their record", () => {
  it("only the review can change", async () => {
    await as(t.app, P.read_only, "read_only", async db => {
      const id = (await db.query("INSERT INTO ai_runs (feature, prompt_version, model, user_id, output, status) VALUES ('pace', 'v1', 'm', $1, 'text', 'ok') RETURNING id", [P.read_only])).rows[0].id;
      expect(await attempt(db, "UPDATE ai_runs SET output = 'rewritten', reviewed_by = $2 WHERE id = $1", [id, P.read_only])).toBe("42501");
      expect(await attempt(db, "UPDATE ai_runs SET cost_micros = 0, reviewed_by = $2 WHERE id = $1", [id, P.read_only])).toBe("42501");
      expect(await attempt(db, "UPDATE ai_runs SET review = 'accepted', reviewed_by = $2 WHERE id = $1", [id, P.read_only])).toBe("ok");
    });
  });
});

describe("finding 5: audit actor type cannot be forged", () => {
  it("a person claiming to be the system is still recorded as a person", async () => {
    await t.app.query("BEGIN");
    await t.app.query("SELECT set_config('app.user_id', $1, true), set_config('app.role', 'bd_support', true), set_config('app.actor_type', 'system', true), set_config('app.request_id', 'forge-1', true)", [P.bd_support]);
    await t.app.query("UPDATE companies SET state = 'Utah' WHERE id = $1", [co1]);
    await t.app.query("SELECT app.log_event('export', 'companies', NULL)");
    await t.app.query("COMMIT");
    const rows = (await t.owner.query("SELECT action, actor_type, actor_id FROM audit_log WHERE request_id = 'forge-1' ORDER BY id")).rows;
    expect(rows).toEqual([{ action: "update", actor_type: "person", actor_id: P.bd_support }, { action: "export", actor_type: "person", actor_id: P.bd_support }]);
  });
});

describe("findings 6 and 7: outbox, errors and proposal versions", () => {
  it("Read only cannot write outbox events or server errors, or errors in someone else's name", async () => {
    await as(t.app, P.read_only, "read_only", async db => {
      expect(await attempt(db, "INSERT INTO outbox (topic, payload) VALUES ('alert.role_changed', '{}')")).toBe("42501");
      expect(await attempt(db, "INSERT INTO errors (source, user_id, message) VALUES ('client', $1, 'x')", [P.owner])).toBe("42501");
      expect(await attempt(db, "INSERT INTO errors (source, user_id, message) VALUES ('worker', NULL, 'x')")).toBe("42501");
      expect(await attempt(db, "INSERT INTO errors (source, user_id, message) VALUES ('client', $1, 'x')", [P.read_only])).toBe("ok");
    });
  });

  it("the worker can fill in a proposal PDF once and change nothing else", async () => {
    const p = (await t.owner.query("INSERT INTO proposals (company_id, number) VALUES ($1, 'OST-H-1') RETURNING id", [co1])).rows[0].id;
    const v = (await t.owner.query("INSERT INTO proposal_versions (proposal_id, v, snapshot, monthly_cents, legacy_id) VALUES ($1, 1, '{}', 100, 'L1') RETURNING id", [p])).rows[0].id;
    await as(t.worker, null, "system", async db => {
      expect(await attempt(db, "UPDATE proposal_versions SET legacy_id = 'L2' WHERE id = $1", [v])).toBe("42501");
      expect(await attempt(db, "UPDATE proposal_versions SET created_at = now() - interval '1 year' WHERE id = $1", [v])).toBe("42501");
      expect(await attempt(db, "UPDATE proposal_versions SET pdf_blob_path = 'p/1.pdf', pdf_sha256 = $2 WHERE id = $1", [v, "b".repeat(64)])).toBe("ok");
    });
  });
});
