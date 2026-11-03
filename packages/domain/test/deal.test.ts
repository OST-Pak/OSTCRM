import { describe, expect, it } from "vitest";
import { activityEffect, isOpen, stageDatesOnSave } from "../src/deal.js";

const T = "2026-11-03";

describe("stageDatesOnSave", () => {
  it("changes nothing when the stage is the same", () => {
    expect(stageDatesOnSave({ stage: "Contacted", signedOn: null }, "Contacted", T)).toEqual({});
  });
  it("stamps the stage date and the first signing date", () => {
    expect(stageDatesOnSave({ stage: "Verbal yes", signedOn: null }, "Signed", T)).toEqual({ stageChangedOn: T, signedOn: T });
    expect(stageDatesOnSave({ stage: "Verbal yes", signedOn: "2026-10-01" }, "Signed", T)).toEqual({ stageChangedOn: T });
  });
  it("clears the signing date when a signed deal moves back", () => {
    expect(stageDatesOnSave({ stage: "Signed", signedOn: "2026-10-01" }, "Verbal yes", T)).toEqual({ stageChangedOn: T, signedOn: null });
  });
});

describe("activityEffect", () => {
  it("does nothing without a deal", () => {
    expect(activityEffect(null, { type: "Call", occurredOn: T }, T)).toEqual({ error: "" });
  });
  it("needs a next step when the deal stays open", () => {
    const d = { stage: "Contacted" as const, proposalSentOn: null };
    expect(activityEffect(d, { type: "Call", direction: "Outbound", occurredOn: T }, T).error).toMatch(/next step/);
    expect(activityEffect(d, { type: "Call", direction: "Outbound", occurredOn: T, nextStep: "Call back", nextStepOn: "2026-11-01" }, T).error).toMatch(/past/);
  });
  it("moves Target to Contacted on the first outbound conversation and carries the next step", () => {
    const e = activityEffect({ stage: "Target", proposalSentOn: null }, { type: "Email", direction: "Outbound", occurredOn: T, nextStep: " Follow up ", nextStepOn: "2026-11-05" }, T);
    expect(e).toEqual({ error: "", stage: "Contacted", nextStep: "Follow up", nextStepOn: "2026-11-05" });
  });
  it("records the first proposal date only", () => {
    const e = activityEffect({ stage: "Discovery done", proposalSentOn: null }, { type: "Proposal sent", occurredOn: "2026-11-02", nextStep: "Chase", nextStepOn: T }, T);
    expect(e.stage).toBe("Proposal sent");
    expect(e.proposalSentOn).toBe("2026-11-02");
    const again = activityEffect({ stage: "Proposal sent", proposalSentOn: "2026-10-01" }, { type: "Proposal sent", occurredOn: T, nextStep: "Chase", nextStepOn: T }, T);
    expect(again.proposalSentOn).toBeUndefined();
  });
  it("needs no next step for a deal that is not open", () => {
    expect(activityEffect({ stage: "Target", proposalSentOn: null }, { type: "Note", occurredOn: T }, T)).toEqual({ error: "" });
    expect(isOpen("Signed")).toBe(false);
  });
});
