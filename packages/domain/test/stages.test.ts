import { describe, expect, it } from "vitest";
import { dealHealth, formatDollars, isOpenStage, lastTouchByCompany, monthlyValueCents, stageSince, touchCount, type Company } from "../src/index.js";

const co = (x: Partial<Company>): Company => ({ id: "c1", name: "Acme PEO", stage: "Contacted", ...x });
const T = "2026-11-10";

describe("stages", () => {
  it("open stages are Contacted through Verbal yes", () => {
    expect(isOpenStage("Contacted")).toBe(true);
    expect(isOpenStage("Verbal yes")).toBe(true);
    expect(isOpenStage("Target")).toBe(false);
    expect(isOpenStage("Signed")).toBe(false);
    expect(isOpenStage("Nurture (Q1)")).toBe(false);
  });

  it("stage start falls back to created date, then today", () => {
    expect(stageSince(co({ stageChangedAt: "2026-11-01" }), T)).toBe("2026-11-01");
    expect(stageSince(co({ createdAt: "2026-10-30T10:00:00Z" }), T)).toBe("2026-10-30");
    expect(stageSince(co({}), T)).toBe(T);
  });

  it("touch count: missing is 1, explicit 0 is 0, negatives are 0", () => {
    expect(touchCount({})).toBe(1);
    expect(touchCount({ count: 0 })).toBe(0);
    expect(touchCount({ count: "0" })).toBe(0);
    expect(touchCount({ count: 25 })).toBe(25);
    expect(touchCount({ count: -3 })).toBe(0);
    expect(touchCount({ count: "abc" })).toBe(1);
  });

  it("last touch ignores bookkeeping rows and rows with no company", () => {
    const m = lastTouchByCompany([
      { companyId: "c1", type: "Email", date: "2026-11-02" },
      { companyId: "c1", type: "Call", date: "2026-11-05" },
      { companyId: "c1", type: "Stage change", date: "2026-11-09" },
      { companyId: "c1", type: "Contacts sequenced", date: "2026-11-09" },
      { companyId: "c1", type: "Meeting booked", date: "2026-11-09" },
      { type: "Note", date: "2026-11-09" }
    ]);
    expect(m.get("c1")).toBe("2026-11-05");
    expect(m.size).toBe(1);
  });
});

describe("deal health", () => {
  const healthy = co({ stageChangedAt: "2026-11-08", nextStep: "Call", nextStepDate: "2026-11-12" });

  it("closed and not-started deals are always good", () => {
    expect(dealHealth(co({ stage: "Signed" }), undefined, T).level).toBe("good");
    expect(dealHealth(co({ stage: "Target" }), undefined, T).level).toBe("good");
  });

  it("good when there is a future next step, within SLA and touched recently", () => {
    expect(dealHealth(healthy, "2026-11-09", T)).toEqual({ level: "good", reasons: [] });
  });

  it("red without a next step or with an overdue one", () => {
    expect(dealHealth(co({ stageChangedAt: T }), T, T).reasons).toContain("No next step");
    expect(dealHealth({ ...healthy, nextStepDate: "2026-11-09" }, T, T).reasons[0]).toMatch(/Next step overdue/);
  });

  it("red when the stage SLA is breached (more than 7 days in Contacted)", () => {
    const h = dealHealth({ ...healthy, stageChangedAt: "2026-11-02" }, T, T);
    expect(h.level).toBe("bad");
    expect(h.reasons).toContain("No reply in 7 days: change angle or channel (8d in stage)");
    expect(dealHealth({ ...healthy, stageChangedAt: "2026-11-03" }, T, T).level).toBe("good");
  });

  it("red with no decision date from Proposal sent onward", () => {
    const p = { ...healthy, stage: "Proposal sent" as const };
    expect(dealHealth(p, T, T).reasons).toContain("No decision date");
    expect(dealHealth({ ...p, decisionDate: "2026-11-14" }, T, T).level).toBe("good");
  });

  it("amber with no activity or no touch in 5 days", () => {
    expect(dealHealth(healthy, undefined, T)).toEqual({ level: "warn", reasons: ["No activity logged"] });
    expect(dealHealth(healthy, "2026-11-05", T).reasons).toEqual(["No touch in 5 days"]);
    expect(dealHealth(healthy, "2026-11-06", T).level).toBe("good");
  });
});

describe("money", () => {
  it("prices staff and manager seats in cents", () => {
    expect(monthlyValueCents({ staffSeats: 2, managerSeats: 1 })).toBe(2 * 220_000 + 320_000);
    expect(monthlyValueCents({ staffSeats: 3 }, { staffSeatCents: 100, managerSeatCents: 200 })).toBe(300);
  });

  it("ignores missing, negative and fractional seats", () => {
    expect(monthlyValueCents({})).toBe(0);
    expect(monthlyValueCents({ staffSeats: -2 })).toBe(0);
    expect(monthlyValueCents({ staffSeats: 1.9 })).toBe(220_000);
  });

  it("formats whole dollars", () => {
    expect(formatDollars(760_000)).toBe("$7,600");
  });
});
