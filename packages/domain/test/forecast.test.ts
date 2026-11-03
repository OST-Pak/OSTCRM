import { describe, expect, it } from "vitest";
import { conversionRate, forecast, measuredFunnel, type Company, type Funnel } from "../src/index.js";

const zero: Funnel = { sequenced: 0, positiveReplies: 0, meetingsHeld: 0, proposalsSent: 0, signed: 0 };
const co = (id: string, stage: Company["stage"], staffSeats = 0): Company => ({ id, name: id, stage, staffSeats });

describe("conversion rates", () => {
  it("uses the assumption until the denominator is large enough", () => {
    expect(conversionRate(1, 2, 3, 35)).toEqual({ value: 0.35, source: "assumed" });
    expect(conversionRate(1, 3, 3, 35)).toEqual({ value: 1 / 3, source: "measured", numerator: 1, denominator: 3 });
  });
});

describe("measured funnel", () => {
  it("counts since the plan start and adds outreach enrolments", () => {
    const f = measuredFunnel({
      companies: [{ ...co("a", "Signed"), signedAt: "2026-11-20" }],
      activities: [
        { type: "Contacts sequenced", count: 100, date: "2026-11-02" },
        { type: "Contacts sequenced", count: 50, date: "2026-10-01" },
        { type: "Email", direction: "Inbound", outcome: "Positive", date: "2026-11-03" },
        { type: "Meeting held", date: "2026-11-05" },
        { type: "Proposal sent", date: "2026-11-07" }
      ],
      outreachEnrolled: 20,
      today: "2026-11-30"
    });
    expect(f).toEqual({ sequenced: 120, positiveReplies: 1, meetingsHeld: 1, proposalsSent: 1, signed: 1 });
  });
});

describe("forecast", () => {
  it("weights open deals by stage probability and signed deals at 1", () => {
    const r = forecast({ companies: [co("a", "Signed", 2), co("b", "Verbal yes", 1), co("c", "Proposal sent"), co("d", "Lost", 5)], funnel: zero, today: "2026-11-10" });
    expect(r.expectedContracts).toBeCloseTo(1 + 0.7 + 0.35, 10);
    expect(r.expectedMonthlyCents).toBe(440_000 + Math.round(220_000 * 0.7));
    expect(r.gap).toBeCloseTo(3 - 2.05, 10);
    expect(r.status).toBe("closable");
  });

  it("is short below 60% of target and covered at target", () => {
    expect(forecast({ companies: [co("a", "Signed")], funnel: zero, today: "2026-11-10" }).status).toBe("short");
    const r = forecast({ companies: [co("a", "Signed"), co("b", "Signed"), co("c", "Signed")], funnel: zero, today: "2026-11-10" });
    expect(r.status).toBe("covered");
    expect(r.needed).toEqual({ sequenced: 0, positiveReplies: 0, meetingsHeld: 0, proposalsSent: 0 });
  });

  it("works the funnel backwards from the gap with assumed rates", () => {
    const r = forecast({ companies: [], funnel: zero, today: "2026-11-10" });
    // gap 3; /0.35 = 8.57 proposals; /0.5 = 17.14 meetings; /0.6 = 28.57 replies; /0.01 = 2857.1 contacts
    expect(r.needed).toEqual({ proposalsSent: 9, meetingsHeld: 18, positiveReplies: 29, sequenced: 2858 });
    expect(r.rates.replyRate.source).toBe("assumed");
  });

  it("last day to book is the deadline minus the cycle; per-week needs use working days left", () => {
    const r = forecast({ companies: [], funnel: zero, today: "2026-11-10" });
    expect(r.lastDayToBook).toBe("2026-11-20");
    expect(r.workdaysLeft).toBe(9);
    expect(r.neededPerWeek.proposalsSent).toBe(Math.ceil((3 / 0.35) / 9 * 5));
  });

  it("after the last day to book, per-week needs use at least one working day", () => {
    const r = forecast({ companies: [], funnel: zero, today: "2026-11-28" });
    expect(r.workdaysLeft).toBe(1);
  });

  it("switches to measured rates when there is enough data", () => {
    const r = forecast({ companies: [], funnel: { sequenced: 400, positiveReplies: 8, meetingsHeld: 4, proposalsSent: 4, signed: 1 }, today: "2026-11-10" });
    expect(r.rates.replyRate).toMatchObject({ source: "measured", value: 0.02 });
    expect(r.rates.proposalToSigned).toMatchObject({ source: "measured", value: 0.25 });
  });
});
