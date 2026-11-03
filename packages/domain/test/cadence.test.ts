import { describe, expect, it } from "vitest";
import { cadenceFor, documentDue, overdueSteps, type Company } from "../src/index.js";

const co = (x: Partial<Company>): Company => ({ id: "c1", name: "Acme PEO", stage: "Contacted", stageChangedAt: "2026-11-02", ...x });
const T = "2026-11-10";

describe("cadence", () => {
  it("dates each step from the stage start", () => {
    const p = cadenceFor(co({}), T);
    expect(p.total).toBe(6);
    expect(p.steps.map(s => s.due)).toEqual(["2026-11-02", "2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-12"]);
    expect(p.next?.index).toBe(0);
  });

  it("ticked steps are done and the next is the first not done", () => {
    const p = cadenceFor(co({ cad: { stage: "Contacted", done: [0, 1, 3] } }), T);
    expect(p.doneCount).toBe(3);
    expect(p.next?.index).toBe(2);
    expect(overdueSteps(p, T).map(s => s.index)).toEqual([2, 4]);
  });

  it("ticks from an earlier stage do not carry over", () => {
    const p = cadenceFor(co({ stage: "Replied", cad: { stage: "Contacted", done: [0, 1, 2] } }), T);
    expect(p.doneCount).toBe(0);
    expect(p.total).toBe(3);
  });

  it("stages without a cadence return an empty plan", () => {
    expect(cadenceFor(co({ stage: "Lost" }), T)).toEqual({ steps: [], next: null, doneCount: 0, total: 0 });
  });

  it("all done means no next step", () => {
    expect(cadenceFor(co({ stage: "Signed", cad: { stage: "Signed", done: [0, 1] } }), T).next).toBeNull();
  });
});

describe("documents due", () => {
  it("proposal due 2 days after discovery", () => {
    expect(documentDue(co({ stage: "Discovery done", stageChangedAt: "2026-11-09" }), T)).toEqual({ kind: "Proposal", due: "2026-11-11" });
  });

  it("contract due 1 day after a verbal yes", () => {
    expect(documentDue(co({ stage: "Verbal yes", stageChangedAt: "2026-11-09" }), T)).toEqual({ kind: "Contract", due: "2026-11-10" });
  });

  it("once the contract is sent, signature due 3 days after it", () => {
    expect(documentDue(co({ stage: "Verbal yes", contractSentDate: "2026-11-10" }), T)).toEqual({ kind: "Signature", due: "2026-11-13" });
  });

  it("decision due 5 days after the proposal was sent, falling back to the stage start", () => {
    expect(documentDue(co({ stage: "Proposal sent", proposalSentDate: "2026-11-06" }), T)).toEqual({ kind: "Decision", due: "2026-11-11" });
    expect(documentDue(co({ stage: "Proposal sent", stageChangedAt: "2026-11-07" }), T)).toEqual({ kind: "Decision", due: "2026-11-12" });
  });

  it("dates set by hand win", () => {
    expect(documentDue(co({ stage: "Discovery done", proposalDueDate: "2026-11-20" }), T)?.due).toBe("2026-11-20");
    expect(documentDue(co({ stage: "Verbal yes", contractDueDate: "2026-11-21" }), T)?.due).toBe("2026-11-21");
    expect(documentDue(co({ stage: "Verbal yes", contractSentDate: "2026-11-10", signatureDueDate: "2026-11-22" }), T)?.due).toBe("2026-11-22");
    expect(documentDue(co({ stage: "Proposal sent", decisionDate: "2026-11-23" }), T)?.due).toBe("2026-11-23");
  });

  it("nothing is due in other stages", () => {
    expect(documentDue(co({ stage: "Contacted" }), T)).toBeNull();
    expect(documentDue(co({ stage: "Signed" }), T)).toBeNull();
  });
});
