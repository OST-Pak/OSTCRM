import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp, type Who } from "./setup.js";

let T: Awaited<ReturnType<typeof testApp>>;
const TODAY = "2026-11-10";
const h = async (who: Who) => ({ ...(await T.auth(who)), "idempotency-key": randomUUID() });
let contacted: string, verbal: string, verbalCo: string;

beforeAll(async () => {
  T = await testApp();
  const co = async (name: string) => (await T.db.owner.query("INSERT INTO companies (name, name_normalized) VALUES ($1, lower($1)) RETURNING id", [name])).rows[0].id as string;
  const a = await co("Alpha PEO"), b = await co("Bravo ASO"), c = await co("Charlie HR"), dup = await co("Alpha dup");
  await T.db.owner.query("UPDATE companies SET duplicate_of = $1 WHERE id = $2", [a, dup]);
  contacted = (await T.db.owner.query("INSERT INTO deals (company_id, stage, owner_id, stage_changed_on, staff_seats) VALUES ($1, 'Contacted', $2, '2026-11-01', 1) RETURNING id", [a, T.people.specialist.id])).rows[0].id;
  verbal = (await T.db.owner.query("INSERT INTO deals (company_id, stage, owner_id, stage_changed_on) VALUES ($1, 'Verbal yes', $2, '2026-11-09') RETURNING id", [b, T.people.bd_support.id])).rows[0].id;
  verbalCo = b;
  await T.db.owner.query("INSERT INTO deals (company_id, stage, stage_changed_on) VALUES ($1, 'Lost', '2026-11-01')", [c]);
  await T.db.owner.query("INSERT INTO activities (company_id, type, occurred_on) VALUES ($1, 'Call', '2026-11-08')", [a]);
});
afterAll(async () => { await T.close(); });

describe("pipeline board", () => {
  it("shows open and signed deals by stage with cadence, touches and documents due", async () => {
    const r = await T.app.inject({ url: `/v1/pipeline?today=${TODAY}`, headers: await T.auth("read_only") });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.open).toBe(2);
    const col = b.columns.find((c: { stage: string }) => c.stage === "Contacted");
    expect(col.cards[0]).toMatchObject({ name: "Alpha PEO", daysInStage: 9, daysSinceTouch: 2, overdue: true });
    expect(col.cards[0].next.channel).toBe("Email");
    expect(b.documents.map((d: { name: string; kind: string }) => [d.name, d.kind])).toEqual([["Bravo ASO", "Contract"]]);
    expect(b.cadence[0].steps.length).toBeGreaterThan(0);
    const mine = (await T.app.inject({ url: `/v1/pipeline?today=${TODAY}&ownerId=${T.people.bd_support.id}`, headers: await T.auth("owner") })).json();
    expect(mine.open).toBe(1);
  });

  it("ticks a cadence step, logs it, and keeps Specialists to their own deals", async () => {
    const other = await T.app.inject({ method: "POST", url: `/v1/deals/${verbal}/cadence`, headers: await h("specialist"), payload: { version: 1, index: 0, today: TODAY } });
    expect(other.statusCode).toBe(403);
    const r = await T.app.inject({ method: "POST", url: `/v1/deals/${contacted}/cadence`, headers: await h("specialist"), payload: { version: 1, index: 0, today: TODAY } });
    expect(r.statusCode).toBe(200);
    expect(r.json().cadence_done).toEqual([0]);
    const plan = (await T.app.inject({ url: `/v1/deals/${contacted}/cadence?today=${TODAY}`, headers: await T.auth("specialist") })).json();
    expect(plan.plan.doneCount).toBe(1);
    const logged = await T.db.owner.query("SELECT type, summary, source FROM activities WHERE deal_id = $1", [contacted]);
    expect(logged.rows[0]).toMatchObject({ type: "Email", source: "Cadence" });
    expect((await T.app.inject({ method: "POST", url: `/v1/deals/${contacted}/cadence`, headers: await h("owner"), payload: { version: 1, index: 1, today: TODAY } })).statusCode).toBe(409);
  });

  it("marks the contract sent once, at Verbal yes only", async () => {
    const r = await T.app.inject({ method: "POST", url: `/v1/deals/${verbal}/contract-sent`, headers: await h("bd_support"), payload: { version: 1, today: TODAY } });
    expect(r.statusCode).toBe(200);
    const d = (await T.db.owner.query("SELECT contract_sent_on::text, signature_due_on::text FROM deals WHERE id = $1", [verbal])).rows[0];
    expect(d).toEqual({ contract_sent_on: TODAY, signature_due_on: "2026-11-13" });
    expect((await T.app.inject({ method: "POST", url: `/v1/deals/${verbal}/contract-sent`, headers: await h("bd_support"), payload: { version: 2, today: TODAY } })).statusCode).toBe(400);
    const b = (await T.app.inject({ url: `/v1/pipeline?today=${TODAY}`, headers: await T.auth("owner") })).json();
    expect(b.documents[0]).toMatchObject({ kind: "Signature", due: "2026-11-13" });
    void verbalCo;
  });
});
