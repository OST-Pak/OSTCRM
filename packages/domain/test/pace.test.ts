import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN, actualAt, paceStatus, planAt, weeklyScorecard, type Activity, type Company } from "../src/index.js";

describe("plan", () => {
  it("is zero on or before the start", () => {
    expect(planAt("meetings", "2026-10-29")).toBe(0);
    expect(planAt("meetings", "2026-10-01")).toBe(0);
  });

  it("hits each plan point exactly and interpolates between them", () => {
    expect(planAt("meetings", "2026-11-13")).toBe(8);
    expect(planAt("signed", "2026-12-11")).toBe(3);
    // Nov 6 = 2, Nov 13 = 8: Nov 9 is 3 of 7 days in
    expect(planAt("meetings", "2026-11-09")).toBeCloseTo(2 + 6 * 3 / 7, 10);
  });

  it("holds the final value after the end", () => {
    expect(planAt("proposals", "2027-01-15")).toBe(11);
  });

  it("is zero for an empty plan", () => {
    expect(planAt("meetings", "2026-11-10", { ...DEFAULT_PLAN, dates: [] })).toBe(0);
  });
});

describe("actuals", () => {
  const acts: Activity[] = [
    { type: "Meeting held", date: "2026-10-20" },
    { type: "Meeting held", date: "2026-11-03" },
    { type: "Meeting held", date: "2026-11-05", count: 2 },
    { type: "Proposal sent", date: "2026-11-06" },
    { type: "Meeting held", date: "2026-11-20" }
  ];
  const cos = [{ signedAt: "2026-11-25" }, { signedAt: undefined }] as Pick<Company, "signedAt">[];

  it("counts activities from the plan start up to the date, honouring counts", () => {
    expect(actualAt("meetings", "2026-11-10", { companies: cos, activities: acts })).toBe(3);
    expect(actualAt("proposals", "2026-11-10", { companies: cos, activities: acts })).toBe(1);
  });

  it("counts signed companies by signed date", () => {
    expect(actualAt("signed", "2026-11-24", { companies: cos, activities: acts })).toBe(0);
    expect(actualAt("signed", "2026-11-25", { companies: cos, activities: acts })).toBe(1);
  });
});

describe("pace status", () => {
  it("is too early or ahead while under 0.75 expected", () => {
    expect(paceStatus(0, 0.5)).toBe("too-early");
    expect(paceStatus(1, 0.5)).toBe("ahead");
  });
  it("is on pace at 100%, slightly behind from 70%, behind below", () => {
    expect(paceStatus(4, 4)).toBe("on-pace");
    expect(paceStatus(2.8, 4)).toBe("slightly-behind");
    expect(paceStatus(2.7, 4)).toBe("behind");
  });
});

describe("weekly scorecard", () => {
  const companies = new Map<string, Company>([
    ["warm", { id: "warm", name: "W", stage: "Contacted", channel: "Warm network" }],
    ["cold", { id: "cold", name: "C", stage: "Contacted", channel: "Cold email" }],
    ["brk", { id: "brk", name: "B", stage: "Contacted", type: "PEO broker" }],
    ["ref", { id: "ref", name: "R", stage: "Contacted", channel: "Referral partner" }]
  ]);
  const row = (rows: ReturnType<typeof weeklyScorecard>, id: string) => rows.find(r => r.id === id)!;

  it("shows setup before the setup cut-off", () => {
    const rows = weeklyScorecard({ activities: [], companiesById: companies, today: "2026-11-01" });
    expect(rows.every(r => r.status === "setup")).toBe(true);
  });

  it("counts only this Monday-to-Sunday week and applies each metric's rule", () => {
    const acts: Activity[] = [
      { companyId: "warm", type: "Call", date: "2026-11-11" },
      { companyId: "warm", type: "Note", date: "2026-11-11" },
      { companyId: "cold", type: "Email", date: "2026-11-11" },
      { companyId: "brk", type: "Email", date: "2026-11-11" },
      { companyId: "ref", type: "Meeting held", date: "2026-11-11" },
      { companyId: "warm", type: "Call", date: "2026-11-08" },
      { type: "Call", direction: "Inbound", outcome: "Positive", date: "2026-11-10" },
      { type: "Contacts sequenced", count: 120, date: "2026-11-10" }
    ];
    const rows = weeklyScorecard({ activities: acts, companiesById: companies, today: "2026-11-11" });
    expect(row(rows, "warmConversations").actual).toBe(1);
    expect(row(rows, "partnerConversations").actual).toBe(2);
    expect(row(rows, "dials").actual).toBe(1 + 0); // the warm call; the cold Email is not a dial, the inbound call is excluded
    expect(row(rows, "positiveReplies").actual).toBe(1);
    expect(row(rows, "contactsSequenced").actual).toBe(120);
    expect(row(rows, "meetingsHeld").actual).toBe(1);
  });

  it("pro-rates targets by working days elapsed: Wednesday is 3 of 5", () => {
    // Dials target 150, red 75: Wednesday needs 90 to be on pace, 45 to avoid red
    const calls = (n: number): Activity[] => [{ type: "Call", count: n, date: "2026-11-11" }];
    const st = (n: number) => row(weeklyScorecard({ activities: calls(n), companiesById: companies, today: "2026-11-11" }), "dials").status;
    expect(st(90)).toBe("on-pace");
    expect(st(89)).toBe("behind");
    expect(st(45)).toBe("behind");
    expect(st(44)).toBe("red");
  });

  it("weekends count as a full week", () => {
    const rows = weeklyScorecard({ activities: [{ type: "Call", count: 149, date: "2026-11-14" }], companiesById: companies, today: "2026-11-15" });
    expect(row(rows, "dials").status).toBe("behind");
  });

  it("metrics with a start date are not scored in earlier weeks", () => {
    const rows = weeklyScorecard({ activities: [], companiesById: companies, today: "2026-11-04" });
    expect(row(rows, "contactsSequenced")).toMatchObject({ status: "not-started", startsOn: "2026-11-09" });
    expect(row(rows, "proposalsSent").status).toBe("not-started");
    expect(row(rows, "dials").status).toBe("red");
    const later = weeklyScorecard({ activities: [], companiesById: companies, today: "2026-11-09" });
    expect(row(later, "contactsSequenced").status).toBe("red");
    expect(row(later, "proposalsSent").status).toBe("not-started");
  });
});
