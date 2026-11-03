import { describe, expect, it } from "vitest";
import { cadenceTick, documentsDue, pipelineBoard, signatureDueAfter, type BoardDeal } from "../src/pipeline.js";

const T = "2026-11-10";
const deal = (id: string, x: Partial<BoardDeal>): BoardDeal => ({ id, name: id, stage: "Contacted", stageChangedAt: "2026-11-01", ...x });

describe("pipelineBoard", () => {
  it("puts open and signed deals in stage columns, counts value and overdue steps", () => {
    const b = pipelineBoard([
      deal("a", { stage: "Contacted", stageChangedAt: "2026-11-01", staffSeats: 1 }),
      deal("b", { stage: "Contacted", stageChangedAt: "2026-11-09" }),
      deal("c", { stage: "Signed", stageChangedAt: "2026-11-10", managerSeats: 1 }),
      deal("t", { stage: "Target" }), deal("l", { stage: "Lost" })
    ], new Map([["a", "2026-11-08"]]), T);
    expect(b.columns.map(c => c.stage)).toEqual(["Contacted", "Replied", "Meeting booked", "Discovery done", "Proposal sent", "Verbal yes", "Signed"]);
    expect(b.open).toBe(3);
    const contacted = b.columns[0]!;
    expect(contacted.cards.map(c => c.id)).toEqual(["a", "b"]);
    expect(contacted.cards[0]).toMatchObject({ daysInStage: 9, daysSinceTouch: 2, overdue: true });
    expect(contacted.cards[1]!.daysSinceTouch).toBeNull();
    expect(contacted.valueCents).toBeGreaterThan(0);
    expect(b.overdue).toBe(2);
  });
});

describe("documentsDue", () => {
  it("lists what is due by kind, soonest first, with a status", () => {
    const rows = documentsDue([
      deal("p", { stage: "Discovery done", stageChangedAt: "2026-11-05" }),
      deal("d", { stage: "Proposal sent", proposalSentDate: "2026-11-05", proposalValueCents: 500_000 }),
      deal("v", { stage: "Verbal yes", stageChangedAt: "2026-11-10" }),
      deal("s", { stage: "Verbal yes", contractSentDate: "2026-11-09" }),
      deal("x", { stage: "Contacted" })
    ], T);
    expect(rows.map(r => [r.id, r.kind, r.due, r.status])).toEqual([
      ["p", "Proposal", "2026-11-07", "overdue"], ["d", "Decision", "2026-11-10", "today"], ["v", "Contract", "2026-11-11", "upcoming"], ["s", "Signature", "2026-11-12", "upcoming"]
    ]);
    expect(rows[1]!.valueCents).toBe(500_000);
  });
});

describe("cadenceTick", () => {
  it("ticks a step and logs the matching activity; drops ticks from an earlier stage", () => {
    const d = deal("a", { stage: "Contacted", cad: { stage: "Replied", done: [0] } });
    expect(cadenceTick(d, 2, T)).toEqual({ error: "", done: [2], activity: { type: "Call", summary: "Cadence step 3: Call; if no answer, leave a 20-second voicemail" } });
    expect(cadenceTick({ ...d, cad: { stage: "Contacted", done: [0] } }, 1, T).done).toEqual([0, 1]);
  });
  it("refuses a missing step and a proposal step", () => {
    expect(cadenceTick(deal("a", {}), 99, T).error).toMatch(/doesn't exist/);
    expect(cadenceTick(deal("a", { stage: "Discovery done" }), 2, T).error).toMatch(/sending the proposal/);
    expect(cadenceTick(deal("a", { stage: "Meeting booked" }), 1, T).activity!.type).toBe("Note");
  });
  it("signature is due three days after the contract", () => {
    expect(signatureDueAfter("2026-11-10")).toBe("2026-11-13");
  });
});
