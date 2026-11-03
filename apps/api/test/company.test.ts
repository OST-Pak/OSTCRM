import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp, type Who } from "./setup.js";

let T: Awaited<ReturnType<typeof testApp>>;
const key = () => ({ "idempotency-key": randomUUID() });
const TODAY = "2026-11-03";
const h = async (who: Who) => ({ ...(await T.auth(who)), ...key() });
const detail = async (id: string, who: Who = "owner") => (await T.app.inject({ url: `/v1/companies/${id}/detail?today=${TODAY}`, headers: await T.auth(who) })).json();
const form = (d: ReturnType<typeof detail> extends Promise<infer R> ? R : never, change: Record<string, unknown> = {}) => ({
  companyVersion: d.company.version, dealVersion: d.deal?.version ?? null, today: TODAY,
  name: d.company.name, type: d.company.type ?? "", ownerId: d.deal?.ownerId ?? d.company.ownerId, stage: d.deal?.stage ?? "Target",
  staffSeats: d.deal?.staffSeats ?? 0, managerSeats: d.deal?.managerSeats ?? 0, nextStep: d.deal?.nextStep ?? "", nextStepOn: d.deal?.nextStepOn ?? null,
  decisionOn: d.deal?.decisionOn ?? null, ...change
});

let co: string;
beforeAll(async () => {
  T = await testApp();
  co = (await T.db.owner.query("INSERT INTO companies (name, name_normalized, type, phone) VALUES ('Northwind PEO', 'northwind', 'PEO', '+1 555 010 9999') RETURNING id")).rows[0].id;
  await T.db.owner.query("INSERT INTO deals (company_id, stage, owner_id, stage_changed_on) VALUES ($1, 'Target', $2, '2026-10-01')", [co, T.people.specialist.id]);
  await T.db.owner.query("INSERT INTO contacts (company_id, name, title, email, phone) VALUES ($1, 'Robin', 'VP Operations', 'robin@northwind.example', '+1 555 010 2222')", [co]);
});
afterAll(async () => { await T.close(); });

describe("company drawer", () => {
  it("reads the company, its deal, contacts, health and timeline in one call", async () => {
    const d = await detail(co);
    expect(d.company.name).toBe("Northwind PEO");
    expect(d.deal.stage).toBe("Target");
    expect(d.contacts[0].bucket).toBeTruthy();
    expect(d.health.level).toBe("good");
    const ro = await detail(co, "read_only");
    expect(ro.contacts[0].email).toBe("r***@northwind.example");
    expect(ro.company.phone).toBe("•••• 9999");
  });

  it("logging the first outbound email moves Target to Contacted and carries the next step", async () => {
    const bad = await T.app.inject({ method: "POST", url: "/v1/activities", headers: await h("bd_support"),
      payload: { companyId: co, type: "Email", direction: "Outbound", occurredOn: TODAY, today: TODAY } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toMatch(/next step/);
    const ok = await T.app.inject({ method: "POST", url: "/v1/activities", headers: await h("bd_support"),
      payload: { companyId: co, type: "Email", direction: "Outbound", occurredOn: TODAY, today: TODAY, summary: "Intro", nextStep: "Call Robin", nextStepOn: "2026-11-05" } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().deal.stage).toBe("Contacted");
    const d = await detail(co);
    expect(d.deal).toMatchObject({ stage: "Contacted", nextStep: "Call Robin", nextStepOn: "2026-11-05", stageChangedOn: TODAY });
    expect(d.activities.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(["Email", "Stage change"]));
    expect(d.activities.find((a: { type: string }) => a.type === "Stage change").summary).toBe("Target → Contacted");
  });

  it("a company with no deal row is at Target: an outbound email creates the deal at Contacted; a note creates nothing", async () => {
    const id = (await T.db.owner.query("INSERT INTO companies (name, name_normalized) VALUES ('Fabrikam HR', 'fabrikam') RETURNING id")).rows[0].id;
    const note = await T.app.inject({ method: "POST", url: "/v1/activities", headers: await h("owner"), payload: { companyId: id, type: "Note", occurredOn: TODAY, today: TODAY } });
    expect(note.statusCode).toBe(201);
    expect((await detail(id)).deal).toBeNull();
    expect((await T.app.inject({ method: "POST", url: "/v1/activities", headers: await h("owner"), payload: { companyId: id, type: "Call", direction: "Outbound", occurredOn: TODAY, today: TODAY } })).statusCode).toBe(400);
    const call = await T.app.inject({ method: "POST", url: "/v1/activities", headers: await h("owner"), payload: { companyId: id, type: "Call", direction: "Outbound", occurredOn: TODAY, today: TODAY, nextStep: "Send deck", nextStepOn: "2026-11-04" } });
    expect(call.statusCode).toBe(201);
    expect((await detail(id)).deal).toMatchObject({ stage: "Contacted", nextStep: "Send deck" });
  });

  it("saves the form with the registry checks, stage dates and a stage event", async () => {
    let d = await detail(co);
    const noValue = await T.app.inject({ method: "PUT", url: `/v1/companies/${co}/deal`, headers: await h("owner"), payload: form(d, { stage: "Proposal sent" }) });
    expect(noValue.statusCode).toBe(400);
    expect(noValue.json().error.message).toMatch(/proposal value or the seats/);
    const r = await T.app.inject({ method: "PUT", url: `/v1/companies/${co}/deal`, headers: await h("owner"),
      payload: form(d, { stage: "Proposal sent", staffSeats: 3, decisionOn: "2026-11-20", fit: "Fit", pain: "Payroll errors every cycle", platform: "PrismHR", website: "https://www.Northwind.example/x" }) });
    expect(r.statusCode).toBe(200);
    d = r.json();
    expect(d.deal).toMatchObject({ stage: "Proposal sent", staffSeats: 3, stageChangedOn: TODAY });
    expect(d.company).toMatchObject({ fit: "Fit", platform: "PrismHR", domain: "northwind.example" });
    expect(d.company.notes.pain).toBe("Payroll errors every cycle");
    expect(d.valueCents).toBeGreaterThan(0);
    const stale = await T.app.inject({ method: "PUT", url: `/v1/companies/${co}/deal`, headers: await h("owner"), payload: { ...form(d), companyVersion: 1 } });
    expect(stale.statusCode).toBe(409);
  });

  it("a Specialist changes their own deal's fields but not company fields or the owner", async () => {
    const d = await detail(co);
    const company = await T.app.inject({ method: "PUT", url: `/v1/companies/${co}/deal`, headers: await h("specialist"), payload: form(d, { name: "Renamed", fit: "Fit", platform: "PrismHR", website: d.company.website, pain: d.company.notes.pain }) });
    expect(company.statusCode).toBe(403);
    const owner = await T.app.inject({ method: "PUT", url: `/v1/companies/${co}/deal`, headers: await h("specialist"), payload: form(d, { ownerId: T.people.bd_support.id, fit: "Fit", platform: "PrismHR", website: d.company.website, pain: d.company.notes.pain }) });
    expect(owner.statusCode).toBe(403);
    const own = await T.app.inject({ method: "PUT", url: `/v1/companies/${co}/deal`, headers: await h("specialist"),
      payload: form(d, { nextStep: "Chase the proposal", nextStepOn: "2026-11-06", fit: "Fit", platform: "PrismHR", website: d.company.website, pain: d.company.notes.pain }) });
    expect(own.statusCode).toBe(200);
    expect(own.json().deal.nextStep).toBe("Chase the proposal");
    expect((await T.app.inject({ method: "PUT", url: `/v1/companies/${co}/deal`, headers: await h("read_only"), payload: form(own.json()) })).statusCode).toBe(403);
  });

  it("adds a prospect with its deal", async () => {
    const r = await T.app.inject({ method: "POST", url: "/v1/companies", headers: await h("bd_support"), payload: { name: "Contoso ASO", type: "ASO", stage: "Target", today: TODAY } });
    expect(r.statusCode).toBe(201);
    expect(r.json().deal.stage).toBe("Target");
    expect((await T.app.inject({ method: "POST", url: "/v1/companies", headers: await h("specialist"), payload: { name: "No", stage: "Target" } })).statusCode).toBe(403);
  });
});

describe("contacts and tasks", () => {
  it("adds, checks and removes contacts; refuses a duplicate email; Specialists can't", async () => {
    const add = await T.app.inject({ method: "POST", url: "/v1/contacts", headers: await h("bd_support"), payload: { companyId: co, name: "Sam", title: "CFO", email: "Sam@Northwind.example", role: "" } });
    expect(add.statusCode).toBe(201);
    const c = add.json();
    expect(c.email).toBe("sam@northwind.example");
    expect((await T.app.inject({ method: "POST", url: "/v1/contacts", headers: await h("bd_support"), payload: { companyId: co, name: "Sam 2", email: "sam@northwind.example" } })).statusCode).toBe(400);
    expect((await T.app.inject({ method: "POST", url: "/v1/contacts", headers: await h("specialist"), payload: { companyId: co, name: "X" } })).statusCode).toBe(403);
    const checked = await T.app.inject({ method: "POST", url: `/v1/contacts/${c.id}/checked`, headers: await h("bd_support"), payload: { version: c.version, today: TODAY } });
    expect(checked.statusCode).toBe(200);
    expect((await detail(co)).contacts.find((x: { id: string }) => x.id === c.id).verified_on).toBe(TODAY);
    const gone = await T.app.inject({ method: "POST", url: `/v1/contacts/${c.id}/archive`, headers: await h("bd_support"), payload: { version: checked.json().version } });
    expect(gone.statusCode).toBe(200);
    expect((await detail(co)).contacts.some((x: { id: string }) => x.id === c.id)).toBe(false);
  });

  it("adds a task and ticks it off", async () => {
    const t = await T.app.inject({ method: "POST", url: "/v1/tasks", headers: await h("specialist"), payload: { title: "Send case study", dueOn: "2026-11-04", companyId: co } });
    expect(t.statusCode).toBe(201);
    expect(t.json().assignee_id).toBe(T.people.specialist.id);
    const done = await T.app.inject({ method: "POST", url: `/v1/tasks/${t.json().id}/done`, headers: await h("specialist"), payload: { version: t.json().version, done: true } });
    expect(done.statusCode).toBe(200);
    expect(done.json().done_at).toBeTruthy();
    expect((await T.app.inject({ method: "POST", url: "/v1/tasks", headers: await h("read_only"), payload: { title: "x", dueOn: TODAY } })).statusCode).toBe(403);
  });

  it("lists people for the owner pickers", async () => {
    const r = (await T.app.inject({ url: "/v1/users", headers: await T.auth("read_only") })).json();
    expect(r.some((u: { name: string }) => u.name === "owner")).toBe(true);
    expect(r.some((u: { name: string }) => u.name === "disabled")).toBe(false);
  });
});
