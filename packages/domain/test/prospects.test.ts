import { describe, expect, it } from "vitest";
import { rankProspects, type ProspectInput } from "../src/prospects.js";

const p = (id: string, x: Partial<ProspectInput> = {}): ProspectInput => ({
  id, name: id, type: "PEO", classified_type: null, fit: null, stage: null, platform: null, size: null, hiring_signal: null,
  research_priority: null, national: null, duplicate: false, trigger_dates: [], contacts: [], ...x
});

describe("rankProspects", () => {
  it("ranks by score and splits into A, B and C", () => {
    const out = rankProspects([p("a"), p("b", { platform: "PrismHR", size: "Large" }), p("c", { type: "ASO" })], "2026-11-03", 1, 1);
    const by = Object.fromEntries(out.map(r => [r.id, r]));
    expect(by.b!.tier).toBe("A");
    expect(by.a!.tier).toBe("B");
    expect(by.c!.tier).toBe("C");
    expect(by.b!.why).toContain("Platform PrismHR +3");
  });
  it("gives no tier to partners, unfit, closed and duplicate accounts", () => {
    const out = rankProspects([p("partner", { type: "Existing client" }), p("unfit", { fit: "Not a fit" }), p("lost", { stage: "Lost" }), p("dupe", { duplicate: true })], "2026-11-03");
    expect(out.every(r => r.tier === null)).toBe(true);
  });
  it("uses the researched type unless the company is a partner or client", () => {
    const out = rankProspects([p("x", { type: "Payroll only", classified_type: "PEO" })], "2026-11-03");
    expect(out[0]!.type).toBe("PEO");
  });
  it("counts only triggers in the last 120 days", () => {
    const out = rankProspects([p("x", { trigger_dates: ["2026-10-01", "2025-01-01", "2026-09"] })], "2026-11-03");
    expect(out[0]!.recentTriggers).toBe(2);
    expect(out[0]!.stage).toBe("Target");
  });
});
