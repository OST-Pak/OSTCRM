import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ACTIONS, ROLE_ACTIONS } from "../src/permissions.js";
import { AUDIENCE, TENANT, testApp, type Who } from "./setup.js";

let T: Awaited<ReturnType<typeof testApp>>;
let acme: { id: string; version: number };
let dealId: string;

beforeAll(async () => {
  T = await testApp();
  acme = (await T.db.owner.query("INSERT INTO companies (name, name_normalized, domain, phone) VALUES ('Acme PEO', 'acme', 'acmepeo.example', '+1 555 010 4477') RETURNING id, version")).rows[0];
  dealId = (await T.db.owner.query("INSERT INTO deals (company_id, stage, owner_id) VALUES ($1, 'Contacted', $2) RETURNING id", [acme.id, T.people.specialist.id])).rows[0].id;
  await T.db.owner.query("INSERT INTO contacts (company_id, name, email, phone) VALUES ($1, 'Pat', 'pat@acmepeo.example', '+1 555 010 1234')", [acme.id]);
  for (let i = 0; i < 120; i++) await T.db.owner.query("INSERT INTO companies (name, name_normalized) VALUES ($1, $1)", [`firm ${String(i).padStart(3, "0")}`]);
});
afterAll(async () => { await T.close(); });

const key = () => ({ "idempotency-key": randomUUID() });

describe("every route has a permission", () => {
  it("refuses to start with a route that has no permission or an unknown one", async () => {
    const app = buildApp({ pool: {} as never, auth: { tenantId: TENANT, audience: AUDIENCE }, logLevel: "silent" });
    expect(() => app.get("/x", async () => "x")).toThrow(/has no permission/);
    const app2 = buildApp({ pool: {} as never, auth: { tenantId: TENANT, audience: AUDIENCE }, logLevel: "silent" });
    expect(() => app2.get("/y", { config: { action: "deal.fly" as never } }, async () => "y")).toThrow(/unknown action/);
    void Fastify;
  });

  it("owner holds every action; only the owner changes roles, purges and AI settings", () => {
    expect([...ROLE_ACTIONS.owner].sort()).toEqual([...ACTIONS].sort());
    for (const r of ["admin", "bd_support", "specialist", "read_only"] as const) {
      for (const a of ["role.change", "record.purge", "ai.settings"] as const) expect(ROLE_ACTIONS[r].has(a)).toBe(false);
    }
    expect([...ROLE_ACTIONS.read_only]).toEqual(["pipeline.read", "error.report"]);
  });
});

describe("sign-in", () => {
  it("health is public; everything else needs a valid Microsoft token", async () => {
    expect((await T.app.inject({ url: "/v1/health" })).statusCode).toBe(200);
    expect((await T.app.inject({ url: "/v1/me" })).statusCode).toBe(401);
    expect((await T.app.inject({ url: "/v1/me", headers: { authorization: "Bearer nonsense" } })).statusCode).toBe(401);
  });

  it("refuses tokens from another tenant, for another audience, expired, or signed with another key", async () => {
    const oid = T.people.owner.oid;
    for (const o of [{ tid: "22222222-2222-4222-8222-222222222222" }, { aud: "api://someone-else" }, { exp: "-10m" }, { wrongKey: true },
      { iss: "https://evil.example/v2.0" }, { idToken: true }]) {
      const r = await T.app.inject({ url: "/v1/me", headers: { authorization: `Bearer ${await T.entra.token(oid, o)}` } });
      expect([JSON.stringify(o), r.statusCode]).toEqual([JSON.stringify(o), 401]);
    }
  });

  it("identity comes from the token: unknown, disabled and role-less people are refused", async () => {
    expect((await T.app.inject({ url: "/v1/me", headers: { authorization: `Bearer ${await T.entra.token(randomUUID())}` } })).statusCode).toBe(403);
    expect((await T.app.inject({ url: "/v1/me", headers: await T.auth("disabled") })).statusCode).toBe(403);
    expect((await T.app.inject({ url: "/v1/me", headers: await T.auth("norole") })).statusCode).toBe(403);
    const me = await T.app.inject({ url: "/v1/me", headers: await T.auth("bd_support") });
    expect(me.json()).toEqual({ id: T.people.bd_support.id, role: "bd_support", name: "bd_support" });
    expect(me.headers["x-request-id"]).toBeTruthy();
  });
});

describe("permissions", () => {
  const writes = async (who: Who) => {
    const h = { ...(await T.auth(who)), ...key() };
    return [
      (await T.app.inject({ method: "POST", url: "/v1/activities", headers: h, payload: { companyId: acme.id, type: "Call", occurredOn: "2026-11-10", nextStep: "Call back", nextStepOn: "2099-01-01" } })).statusCode,
      (await T.app.inject({ method: "PATCH", url: `/v1/companies/${acme.id}`, headers: h, payload: { version: 999, state: "Ohio" } })).statusCode,
      (await T.app.inject({ url: "/v1/exports/companies.csv", headers: h })).statusCode,
      (await T.app.inject({ method: "POST", url: `/v1/users/${T.people.read_only.id}/role`, headers: { ...h, ...key() }, payload: { role: "specialist", reason: "test" } })).statusCode
    ];
  };

  it("Read only cannot write anything", async () => {
    expect(await writes("read_only")).toEqual([403, 403, 403, 403]);
  });

  it("each role gets exactly what the brief allows", async () => {
    expect(await writes("specialist")).toEqual([201, 403, 403, 403]);
    expect(await writes("bd_support")).toEqual([201, 409, 403, 403]);
    expect(await writes("admin")).toEqual([201, 409, 200, 403]);
  });

  it("refusals are written to the audit log", async () => {
    const r = await T.db.owner.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'denied' AND actor_id = $1", [T.people.read_only.id]);
    expect(r.rows[0].n).toBeGreaterThanOrEqual(4);
  });

  it("a Specialist cannot move someone else's deal", async () => {
    const other = (await T.db.owner.query("INSERT INTO deals (company_id, stage, offer, owner_id) VALUES ($1, 'Contacted', 'pilot', $2) RETURNING id, version", [acme.id, T.people.owner.id])).rows[0];
    const r = await T.app.inject({ method: "POST", url: `/v1/deals/${other.id}/stage`, headers: { ...(await T.auth("specialist")), ...key() }, payload: { version: other.version, stage: "Replied" } });
    expect(r.statusCode).toBe(403);
    expect((await T.db.owner.query("SELECT stage FROM deals WHERE id = $1", [other.id])).rows[0].stage).toBe("Contacted");
  });
});

describe("lists", () => {
  it("pages on the server with a cursor and no silent cap", async () => {
    const h = await T.auth("read_only");
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { items: { id: string }[]; nextCursor: string | null } = (await T.app.inject({ url: `/v1/companies?limit=50${cursor ? `&cursor=${cursor}` : ""}`, headers: h })).json();
      seen.push(...r.items.map(i => i.id));
      cursor = r.nextCursor;
    } while (cursor);
    const total = (await T.db.owner.query("SELECT count(*)::int AS n FROM companies WHERE archived_at IS NULL AND duplicate_of IS NULL")).rows[0].n;
    expect(seen.length).toBe(total);
    expect(new Set(seen).size).toBe(total);
  });

  it("searches safely and validates input", async () => {
    const h = await T.auth("read_only");
    expect((await T.app.inject({ url: "/v1/companies?q=acme", headers: h })).json().items.map((i: { name: string }) => i.name)).toEqual(["Acme PEO"]);
    expect((await T.app.inject({ url: "/v1/companies?q=%25", headers: h })).json().items).toEqual([]);
    expect((await T.app.inject({ url: "/v1/companies?limit=5000", headers: h })).statusCode).toBe(400);
    expect((await T.app.inject({ url: "/v1/companies?cursor=garbage", headers: h })).statusCode).toBe(400);
  });

  it("masks phone numbers and emails for Read only and logs the view", async () => {
    const ro = (await T.app.inject({ url: `/v1/companies/${acme.id}`, headers: await T.auth("read_only") })).json();
    expect(ro.phone).toBe("•••• 4477");
    expect(ro.contacts[0]).toMatchObject({ email: "p***@acmepeo.example", phone: "•••• 1234" });
    const bd = (await T.app.inject({ url: `/v1/companies/${acme.id}`, headers: await T.auth("bd_support") })).json();
    expect(bd.contacts[0].email).toBe("pat@acmepeo.example");
    const v = await T.db.owner.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'view' AND entity_id = $1", [acme.id]);
    expect(v.rows[0].n).toBe(2);
  });
});

describe("concurrent edits", () => {
  it("a stale version returns 409 with the current record instead of overwriting", async () => {
    const h = await T.auth("bd_support");
    const v = (await T.db.owner.query("SELECT version FROM companies WHERE id = $1", [acme.id])).rows[0].version;
    const a = await T.app.inject({ method: "PATCH", url: `/v1/companies/${acme.id}`, headers: h, payload: { version: v, state: "Ohio" } });
    expect(a.statusCode).toBe(200);
    expect(a.json().version).toBe(v + 1);
    const b = await T.app.inject({ method: "PATCH", url: `/v1/companies/${acme.id}`, headers: h, payload: { version: v, state: "Texas" } });
    expect(b.statusCode).toBe(409);
    expect(b.json().error.details.current.state).toBe("Ohio");
  });

  it("rejects unknown fields instead of ignoring them", async () => {
    const r = await T.app.inject({ method: "PATCH", url: `/v1/companies/${acme.id}`, headers: await T.auth("bd_support"), payload: { version: 1, owner: "Saad" } });
    expect(r.statusCode).toBe(400);
  });
});

describe("commands", () => {
  it("a double click or retry never creates two activities", async () => {
    const h = { ...(await T.auth("bd_support")), ...key() };
    const body = { companyId: acme.id, type: "Email", direction: "Outbound", occurredOn: "2026-11-11", summary: "Follow-up", nextStep: "Chase", nextStepOn: "2099-01-01" };
    const [a, b] = await Promise.all([1, 2].map(() => T.app.inject({ method: "POST", url: "/v1/activities", headers: h, payload: body })));
    expect([a!.statusCode, b!.statusCode]).toEqual([201, 201]);
    expect(a!.json().id).toBe(b!.json().id);
    const n = await T.db.owner.query("SELECT count(*)::int AS n FROM activities WHERE summary = 'Follow-up'");
    expect(n.rows[0].n).toBe(1);
    const reused = await T.app.inject({ method: "POST", url: "/v1/activities", headers: h, payload: { ...body, summary: "Different" } });
    expect(reused.statusCode).toBe(422);
    expect((await T.app.inject({ method: "POST", url: "/v1/activities", headers: await T.auth("bd_support"), payload: body })).statusCode).toBe(400);
  });

  it("moving a stage writes the deal, a stage event and an outbox event together", async () => {
    const v = (await T.db.owner.query("SELECT version FROM deals WHERE id = $1", [dealId])).rows[0].version;
    const r = await T.app.inject({ method: "POST", url: `/v1/deals/${dealId}/stage`, headers: { ...(await T.auth("specialist")), ...key() }, payload: { version: v, stage: "Replied", onDate: "2026-11-12" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ stage: "Replied", stage_changed_on: expect.stringContaining("2026-11-1") });
    const ev = await T.db.owner.query("SELECT from_stage, to_stage FROM deal_stage_events WHERE deal_id = $1", [dealId]);
    expect(ev.rows).toEqual([{ from_stage: "Contacted", to_stage: "Replied" }]);
    const ob = await T.db.owner.query("SELECT count(*)::int AS n FROM outbox WHERE topic = 'deal.stage_changed' AND payload->>'dealId' = $1", [dealId]);
    expect(ob.rows[0].n).toBe(1);
  });

  it("a failure part-way leaves nothing behind (closes known issue 2)", async () => {
    const before = (await T.db.owner.query("SELECT count(*)::int AS n FROM idempotency_keys")).rows[0].n;
    const r = await T.app.inject({ method: "POST", url: "/v1/activities", headers: { ...(await T.auth("bd_support")), ...key() },
      payload: { companyId: randomUUID(), type: "Call", occurredOn: "2026-11-11" } });
    expect(r.statusCode).toBe(400);
    expect((await T.db.owner.query("SELECT count(*)::int AS n FROM idempotency_keys")).rows[0].n).toBe(before);
  });

  it("archiving a company archives its open deals, tasks and outreach, keeps activities, and needs confirmation", async () => {
    const c = (await T.db.owner.query("INSERT INTO companies (name, name_normalized) VALUES ('Archive Me', 'archive me') RETURNING id, version")).rows[0];
    await T.db.owner.query("INSERT INTO deals (company_id, stage) VALUES ($1, 'Replied')", [c.id]);
    await T.db.owner.query("INSERT INTO tasks (title, company_id) VALUES ('call', $1)", [c.id]);
    await T.db.owner.query("INSERT INTO activities (company_id, type, occurred_on) VALUES ($1, 'Call', '2026-11-10')", [c.id]);
    const h = { ...(await T.auth("bd_support")), ...key() };
    expect((await T.app.inject({ method: "POST", url: `/v1/companies/${c.id}/archive`, headers: h, payload: { version: c.version } })).statusCode).toBe(400);
    const r = await T.app.inject({ method: "POST", url: `/v1/companies/${c.id}/archive`, headers: { ...h, ...key() }, payload: { version: c.version, confirm: true } });
    expect(r.json()).toMatchObject({ deals: 1, tasks: 1, outreachSteps: 0 });
    expect((await T.db.owner.query("SELECT count(*)::int AS n FROM activities WHERE company_id = $1", [c.id])).rows[0].n).toBe(1);
    expect((await T.app.inject({ url: `/v1/companies/${c.id}`, headers: await T.auth("bd_support") })).statusCode).toBe(404);
  });

  it("role changes need a reason, are owner-only, cannot target yourself, and alert", async () => {
    const h = await T.auth("owner");
    expect((await T.app.inject({ method: "POST", url: `/v1/users/${T.people.read_only.id}/role`, headers: { ...h, ...key() }, payload: { role: "specialist" } })).statusCode).toBe(400);
    expect((await T.app.inject({ method: "POST", url: `/v1/users/${T.people.owner.id}/role`, headers: { ...h, ...key() }, payload: { role: "admin", reason: "oops" } })).statusCode).toBe(400);
    const ok = await T.app.inject({ method: "POST", url: `/v1/users/${T.people.read_only.id}/role`, headers: { ...h, ...key() }, payload: { role: "specialist", reason: "Joining discovery calls" } });
    expect(ok.json()).toMatchObject({ role: "specialist", reason: "Joining discovery calls" });
    const a = await T.db.owner.query("SELECT reason FROM audit_log WHERE entity = 'role_assignments' AND action = 'create' ORDER BY id DESC LIMIT 1");
    expect(a.rows[0].reason).toBe("Joining discovery calls");
    expect((await T.db.owner.query("SELECT count(*)::int AS n FROM outbox WHERE topic = 'alert.role_changed'")).rows[0].n).toBe(1);
    // Put the role back for other tests.
    await T.app.inject({ method: "POST", url: `/v1/users/${T.people.read_only.id}/role`, headers: { ...h, ...key() }, payload: { role: "read_only", reason: "Test reset" } });
  });
});

describe("duplicates", () => {
  it("a duplicate key returns 409 without naming the constraint", async () => {
    const { fromPg } = await import("../src/errors.js");
    const e = fromPg({ code: "23505", constraint: "companies_domain_uq" })!;
    expect([e.status, e.details]).toEqual([409, undefined]);
  });
});

describe("exports and errors", () => {
  it("bulk export is logged and alerts the owner, and neutralizes spreadsheet formulas", async () => {
    await T.db.owner.query("INSERT INTO companies (name, name_normalized) VALUES ('=HYPERLINK(\"x\")', 'zzz formula')");
    const r = await T.app.inject({ url: "/v1/exports/companies.csv", headers: await T.auth("admin") });
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.body.split("\r\n")[0]).toBe("name,domain,type,state,platform,owner,stage,next_step_on");
    expect(r.body).toContain(`"'=HYPERLINK(""x"")"`);
    await T.db.owner.query("INSERT INTO companies (name, name_normalized) VALUES (E'\\tcmd', 'zzz tab')");
    expect((await T.app.inject({ url: "/v1/exports/companies.csv", headers: await T.auth("admin") })).body).toContain(`"'\tcmd"`);
    expect((await T.db.owner.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'export'")).rows[0].n).toBeGreaterThan(0);
    expect((await T.db.owner.query("SELECT count(*)::int AS n FROM outbox WHERE topic = 'alert.bulk_export'")).rows[0].n).toBeGreaterThan(0);
  });

  it("client errors are stored with the request id; error responses carry it too", async () => {
    const h = await T.auth("read_only");
    expect((await T.app.inject({ method: "POST", url: "/v1/errors", headers: h, payload: { message: "Board failed to render", route: "/pipeline", requestId: "req-abc-123" } })).statusCode).toBe(204);
    expect((await T.db.owner.query("SELECT count(*)::int AS n FROM errors WHERE context->>'clientRequestId' = 'req-abc-123' AND source = 'client' AND request_id <> 'req-abc-123'")).rows[0].n).toBe(1);
    const bad = await T.app.inject({ url: `/v1/companies/not-a-uuid`, headers: h });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().requestId).toBeTruthy();
  });

  it("the audit log is readable by owner and admin only", async () => {
    expect((await T.app.inject({ url: "/v1/audit?limit=5", headers: await T.auth("bd_support") })).statusCode).toBe(403);
    const r = await T.app.inject({ url: "/v1/audit?limit=5", headers: await T.auth("admin") });
    expect(r.json().items).toHaveLength(5);
  });
});

describe("prospects", () => {
  it("returns every company with a tier, filters and pages", async () => {
    await T.db.owner.query("UPDATE companies SET type = 'PEO', platform_name = 'PrismHR', size = 'Large', state = 'TX' WHERE id = $1", [acme.id]);
    const r = await T.app.inject({ url: "/v1/prospects?limit=10", headers: await T.auth("read_only") });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.total).toBeGreaterThanOrEqual(121);
    expect(b.items).toHaveLength(10);
    expect(b.items[0].name).toBe("Acme PEO");
    expect(b.items[0].tier).toBe("A");
    expect(b.items[0].why).toContain("Platform PrismHR +3");
    expect(b.facets.states).toContain("TX");
    const f = (await T.app.inject({ url: "/v1/prospects?q=acme&state=TX", headers: await T.auth("specialist") })).json();
    expect(f.items.map((x: { name: string }) => x.name)).toEqual(["Acme PEO"]);
    const p2 = (await T.app.inject({ url: "/v1/prospects?sort=name&offset=10&limit=5", headers: await T.auth("owner") })).json();
    expect(p2.offset).toBe(10);
    expect(p2.items).toHaveLength(5);
  });
  it("needs a sign-in", async () => {
    expect((await T.app.inject({ url: "/v1/prospects" })).statusCode).toBe(401);
  });
});
