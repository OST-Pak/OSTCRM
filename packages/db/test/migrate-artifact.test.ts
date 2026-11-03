import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadTransformed } from "../migrate-artifact/load.js";
import { maskExport } from "../migrate-artifact/mask.js";
import { reportMarkdown } from "../migrate-artifact/report.js";
import { transformExport } from "../migrate-artifact/transform.js";
import type { ArtifactExport, PersonMapping, Row } from "../migrate-artifact/types.js";
import { freshDb, type TestDb } from "./helpers.js";

// Synthetic data only. Never use a real export in tests.
const fixture = (): ArtifactExport => JSON.parse(readFileSync(new URL("./fixtures/export.json", import.meta.url), "utf8"));
const people = (): PersonMapping[] => JSON.parse(readFileSync(new URL("./fixtures/people.json", import.meta.url), "utf8"));
const rows = (t: ReturnType<typeof transformExport>, table: string): Row[] => t.tables.find(([n]) => n === table)?.[1] ?? [];
const byLegacy = (t: ReturnType<typeof transformExport>, table: string, id: string) => rows(t, table).find(r => r.legacy_id === id)!;

describe("transform", () => {
  const t = transformExport(fixture(), { people: people() });

  it("rejects a file that is not an export, and a mapping without the owner", () => {
    expect(() => transformExport({ ...fixture(), formatVersion: 2 as 1 }, { people: people() })).toThrow(/formatVersion 1/);
    expect(() => transformExport(fixture(), { people: people().filter(p => p.teamName !== "Saad") })).toThrow(/owner/);
  });

  it("maps self-chosen team names to real people and carries roles over", () => {
    const users = rows(t, "users");
    expect(users.map(u => [u.legacy_team_name, u.legacy_uid, u.email])).toEqual([["Saad", "u_owner", "saad@oakstreet.example"], ["Awais", "u_bd", "awais@oakstreet.example"]]);
    const roles = Object.fromEntries(rows(t, "role_assignments").map(r => [users.find(u => u.id === r.user_id)!.legacy_team_name, r.role]));
    expect(roles).toEqual({ Saad: "owner", Awais: "bd_support" });
    expect(t.report.adjusted).toContainEqual({ collection: "members", id: "u_ghost", note: expect.stringMatching(/Ammar/) });
  });

  it("keeps original ids, normalizes domains and moves unmapped fields to extra", () => {
    const acme = byLegacy(t, "companies", "c_acme");
    expect(acme).toMatchObject({ name: "Acme PEO, LLC", name_normalized: "acme", domain: "acmepeo.example", type: "PEO", duplicate_of: null });
    expect(acme.extra).toEqual({ naics: ["561330"], notes: "Met at a conference" });
    expect(acme.created_by).toBe(rows(t, "users")[0]!.id);
    expect(byLegacy(t, "companies", "c_beta")).toMatchObject({ domain: "betapayroll.example", platform_name: "isolved" });
  });

  it("links marked duplicates and domain clashes to the first company instead of failing", () => {
    expect(byLegacy(t, "companies", "c_beta_dup").duplicate_of).toBe(byLegacy(t, "companies", "c_beta").id);
    expect(byLegacy(t, "companies", "c_clash").duplicate_of).toBe(byLegacy(t, "companies", "c_acme").id);
    expect(t.report.adjusted.find(a => a.id === "c_clash")?.note).toMatch(/Shares the domain/);
  });

  it("splits the deal out of the company, with stage, seats, dates and cadence", () => {
    const d = byLegacy(t, "deals", "deal:c_acme");
    expect(d).toMatchObject({ stage: "Proposal sent", stage_changed_on: "2026-11-20", staff_seats: 2, manager_seats: 1, decision_on: "2026-11-25",
      proposal_sent_on: "2026-11-20", cadence_stage: "Proposal sent", cadence_done: [0, 1], economic_buyer_id: byLegacy(t, "contacts", "k_ceo").id });
    expect(byLegacy(t, "deals", "deal:c_beta")).toBeUndefined();
    // An unknown stage loads as Target, and a Target company with no deal data gets no deal.
    expect(byLegacy(t, "deals", "deal:c_odd")).toBeUndefined();
    expect(t.report.dealsPerStage).toEqual({ "Proposal sent": 1, "Signed": 1 });
  });

  it("does not quietly drop anything: unknown owners, odd stages and bad rows are reported", () => {
    expect(t.report.adjusted.find(a => a.id === "c_signed")?.note).toMatch(/Owner "Nobody"/);
    expect(t.report.adjusted.find(a => a.id === "c_odd")?.note).toMatch(/Unknown stage/);
    expect(t.report.rejected).toEqual(expect.arrayContaining([
      { collection: "companies", id: "c_noname", reason: "No company name" },
      { collection: "contacts", id: "k_orphan", reason: "Company not found" },
      { collection: "activities", id: "a4", reason: "No valid date" },
      { collection: "activities", id: "a5", reason: "Company not found" },
      { collection: "tasks", id: "t2", reason: "No title" },
      { collection: "proposals", id: "pr2", reason: "Company not found" },
      { collection: "proposalVersions", id: "v2b", reason: "Version 2 appears twice for this proposal" }
    ]));
  });

  it("lower-cases emails, clears invalid ones and keeps duplicates in extra", () => {
    expect(byLegacy(t, "contacts", "k_ceo").email).toBe("pat@acmepeo.example");
    expect(byLegacy(t, "contacts", "k_dup")).toMatchObject({ email: null, extra: { duplicateEmail: "pat@acmepeo.example" } });
    expect(byLegacy(t, "contacts", "k_bad").email).toBeNull();
  });

  it("activities keep touch counts and are summed per person per week", () => {
    expect(byLegacy(t, "activities", "a2").touch_count).toBe(120);
    expect(byLegacy(t, "activities", "a3").touch_count).toBe(0);
    expect(byLegacy(t, "activities", "a6").touch_count).toBe(2);
    expect(t.report.activitiesPerPersonPerWeek).toEqual({ "Saad | 2026-11-02": 1, "Awais | 2026-11-02": 120, "Saad | 2026-11-16": 0, "Saad | 2026-11-09": 2 });
  });

  it("converts money to cents and keeps proposal versions", () => {
    expect(byLegacy(t, "proposals", "pr1")).toMatchObject({ status: "Sent", monthly_cents: 760_000, sent_version: 2, latest_version: 2 });
    expect(rows(t, "proposal_versions").map(v => [v.v, v.monthly_cents])).toEqual([[1, 440_000], [2, 760_000]]);
    expect(t.report.proposals).toEqual({ total: 1, sent: 1, versions: 2, monthlyCentsSent: 760_000 });
    const tpl = rows(t, "config_proposal_template")[0]!;
    expect(tpl.lines).toEqual([{ service: "Payroll specialist", kind: "staff", seats: 2, priceCents: 220_000 }]);
  });

  it("links clients to their company by domain and keeps seeded month-only triggers", () => {
    expect(rows(t, "clients")[0]).toMatchObject({ name: "Delta Staffing", company_id: byLegacy(t, "companies", "c_signed").id, started_on: "2026-12-05" });
    const seeded = byLegacy(t, "triggers", "seed:c_beta:0");
    expect(seeded).toMatchObject({ occurred_on: "2026-09-15", date_precision: "month", type: "Platform migration" });
    expect(byLegacy(t, "triggers", "tr1").source_url).toBe("https://jobs.example/acme");
  });

  it("imports the old audit trail with its hashes and says what was not migrated", () => {
    const a = rows(t, "audit_log");
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ action: "legacy:update", entity: "companies", entity_id: "c_acme", before: { stage: "Meeting booked" } });
    expect((a[0]!.after as Row)._legacy).toMatchObject({ hash: "h1" });
    expect(t.report.notMigrated.map(n => n.what)).toEqual(expect.arrayContaining(["config/roles", "config/forecast", "audit hash chain"]));
  });

  it("writes a readable report", () => {
    const md = reportMarkdown(t.report);
    expect(md).toContain("## Rejected (7)");
    expect(md).toContain("| Proposal sent | 1 |");
    expect(md).toContain("Monthly value of sent proposals: $7,600");
  });
});

describe("mask", () => {
  it("replaces names, contact details and free text, keeps structure, and is deterministic", () => {
    const m = maskExport(fixture(), "a-long-test-secret-123");
    const acme = m.collections.companies!.find(c => c.id === "c_acme")!;
    expect(acme.name).toMatch(/^Company [0-9a-f]{8}$/);
    expect(acme.domain).toMatch(/^[0-9a-f]{8}\.example\.com$/);
    expect(acme.notes).toBe("[masked 19 chars]");
    expect(acme).toMatchObject({ stage: "Proposal sent", staffSeats: 2, stageChangedAt: "2026-11-20", type: "PEO" });
    const k = m.collections.contacts!.find(c => c.id === "k_ceo")!;
    expect(k.name).toMatch(/^Person /);
    expect(String(k.email)).not.toContain("acme");
    expect(m.collections.auditDays).toEqual([]);
    // Same input, same mask; clients still match their company by masked domain.
    const signed = m.collections.companies!.find(c => c.id === "c_signed")!;
    expect(m.collections.clients![0]!.domain).toBe(signed.domain);
    expect(JSON.stringify(m)).not.toMatch(/Acme|Pat Example|conference/);
    expect(() => maskExport(fixture(), "short")).toThrow(/16 characters/);
  });

  it("a masked export still transforms cleanly", () => {
    const t = transformExport(maskExport(fixture(), "a-long-test-secret-123"), { people: people() });
    expect(t.report.dealsPerStage).toEqual({ "Proposal sent": 1, "Signed": 1 });
  });
});

describe("load", () => {
  let db: TestDb;
  beforeAll(async () => { db = await freshDb(); });
  afterAll(async () => { await db.drop(); });

  it("loads everything in one transaction with foreign keys and checks enforced", async () => {
    const t = transformExport(fixture(), { people: people() });
    const counts = await loadTransformed(db.owner, t);
    for (const [table, list] of t.tables) expect([table, counts[table]]).toEqual([table, list.length]);
    const r = await db.owner.query("SELECT c.name, d.stage, d.staff_seats FROM deals d JOIN companies c ON c.id = d.company_id ORDER BY c.name");
    expect(r.rows).toEqual([{ name: "Acme PEO, LLC", stage: "Proposal sent", staff_seats: 2 }, { name: "Delta Staffing", stage: "Signed", staff_seats: 3 }]);
    const audit = await db.owner.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'create' AND actor_type = 'system' AND reason = 'artifact migration'");
    expect(audit.rows[0].n).toBeGreaterThan(20);
  });

  it("refuses to load twice into the same database", async () => {
    await expect(loadTransformed(db.owner, transformExport(fixture(), { people: people() }))).rejects.toThrow(/already has/);
  });

  it("rolls back completely when a row breaks a rule", async () => {
    const t2 = await freshDb();
    try {
      const t = transformExport(fixture(), { people: people() });
      rows(t, "deals")[0]!.staff_seats = -1;
      await expect(loadTransformed(t2.owner, t)).rejects.toThrow();
      expect((await t2.owner.query("SELECT count(*)::int AS n FROM companies")).rows[0].n).toBe(0);
    } finally { await t2.drop(); }
  });
});
