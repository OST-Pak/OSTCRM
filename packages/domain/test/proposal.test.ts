import { describe, expect, it } from "vitest";
import { fillVars, proposalMonthlyCents, validateProposal, type ProposalDraft } from "../src/index.js";

// Fictional client name for tests. Real client names live only in the config table.
const BLOCKED = ["Acme Payroll"];

const draft = (x: Partial<ProposalDraft> = {}): ProposalDraft => ({
  to: ["jane@example.com"],
  subject: "Proposal: a dedicated back-office team for {{company}}",
  intro: "Hi {{first_name}},",
  scope: "Payroll processing and QA",
  terms: "Start date: {{start_date}}.\nMinimum term: 1 year. After the first year, either party may end the agreement with 90 days' written notice.",
  closing: "Saad",
  pilotOn: false,
  pilotText: "Pilot: {{pilot_seats}} seat(s)",
  lines: [{ service: "Payroll specialist", kind: "staff", seats: 2, priceCents: 220_000 }],
  ...x
});
const vars = { company: "Example PEO", first_name: "Jane", start_date: "December 1, 2026", pilot_seats: "1" };

describe("proposal totals", () => {
  it("sums seats times price in cents and ignores junk", () => {
    expect(proposalMonthlyCents([{ service: "a", kind: "staff", seats: 2, priceCents: 220_000 }, { service: "b", kind: "manager", seats: 1, priceCents: 320_000 }])).toBe(760_000);
    expect(proposalMonthlyCents([{ service: "a", kind: "staff", seats: Number("x"), priceCents: 100 }, { service: "b", kind: "staff", seats: -1, priceCents: 100 }])).toBe(0);
  });
});

describe("placeholders", () => {
  it("fills known values and leaves unknown or empty ones in place", () => {
    expect(fillVars("{{company}} / {{missing}} / {{empty}}", { company: "X", empty: "" })).toBe("X / {{missing}} / {{empty}}");
    expect(fillVars("", {})).toBe("");
  });
});

describe("proposal validation", () => {
  it("passes a complete proposal", () => {
    expect(validateProposal(draft(), vars, BLOCKED)).toBe("");
  });

  it("rejects bad addresses", () => {
    expect(validateProposal(draft({ to: ["jane@", "ok@example.com"] }), vars, BLOCKED)).toBe("Check these addresses: jane@");
  });

  it("rejects a zero total", () => {
    expect(validateProposal(draft({ lines: [] }), vars, BLOCKED)).toBe("Add at least one line with seats and a price.");
  });

  it("rejects unfilled placeholders", () => {
    expect(validateProposal(draft(), { ...vars, start_date: "" }, BLOCKED)).toBe("Fill these placeholders first: {{start_date}}");
  });

  it("checks the pilot text only when the pilot is on", () => {
    expect(validateProposal(draft({ pilotText: "{{nope}}" }), vars, BLOCKED)).toBe("");
    expect(validateProposal(draft({ pilotOn: true, pilotText: "{{nope}}" }), vars, BLOCKED)).toMatch(/\{\{nope\}\}/);
  });

  it("rejects bracketed draft text", () => {
    expect(validateProposal(draft({ terms: "[Add the minimum term and notice period]" }), vars, BLOCKED)).toBe("Replace the bracketed text first: [Add the minimum term and notice period]");
  });

  it("blocks client names in any spacing or case", () => {
    expect(validateProposal(draft({ scope: "As we do for acme  payroll" }), vars, BLOCKED)).toBe("Remove the client name (Acme Payroll) first.");
    expect(validateProposal(draft({ scope: "As we do for AcmePayroll" }), vars, BLOCKED)).toBe("Remove the client name (Acme Payroll) first.");
    expect(validateProposal(draft(), vars, ["  "])).toBe("");
  });
});
