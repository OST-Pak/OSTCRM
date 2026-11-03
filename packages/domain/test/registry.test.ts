import { describe, expect, it } from "vitest";
import { canAddProposalVersion, importMatcher, needsNextStep, nextStage, validateDealSave, type DealDraft } from "../src/index.js";

// Each rule: a normal case, an edge case, and a case that must be rejected (build instructions, "Tests").

describe("save validation", () => {
  const ok: DealDraft = { name: "Acme PEO", stage: "Contacted", nextStep: "Call", nextStepDate: "2026-11-12" };

  it("accepts a complete open deal and a Target with no next step", () => {
    expect(validateDealSave(ok)).toBe("");
    expect(validateDealSave({ name: "Acme PEO", stage: "Target" })).toBe("");
  });

  it("requires a name; whitespace is not a name", () => {
    expect(validateDealSave({ ...ok, name: "   " })).toBe("Company name is required.");
  });

  it("open deals need both a next step and a date", () => {
    expect(validateDealSave({ ...ok, nextStepDate: undefined })).toBe("Open deals need a next step and a date.");
    expect(validateDealSave({ ...ok, nextStep: " " })).toBe("Open deals need a next step and a date.");
    expect(validateDealSave({ ...ok, stage: "Verbal yes", staffSeats: 1, nextStep: undefined })).toBe("Open deals need a next step and a date.");
  });

  it("Proposal sent through Signed need a value or seats", () => {
    const p = { ...ok, stage: "Proposal sent" as const };
    expect(validateDealSave(p)).toBe("Enter the proposal value or the seats before moving to this stage.");
    expect(validateDealSave({ ...p, proposalValueCents: 440_000 })).toBe("");
    expect(validateDealSave({ ...p, managerSeats: 1 })).toBe("");
    expect(validateDealSave({ ...p, stage: "Discovery done" })).toBe("");
  });

  it("Signed needs seats; a value alone is not enough", () => {
    expect(validateDealSave({ name: "Acme", stage: "Signed", proposalValueCents: 440_000 })).toBe("Signed deals need staff or manager seats.");
    expect(validateDealSave({ name: "Acme", stage: "Signed", staffSeats: 2 })).toBe("");
  });

  it("Lost and Nurture need a reason", () => {
    expect(validateDealSave({ name: "Acme", stage: "Lost" })).toBe("Pick a lost or stalled reason, and note what they said.");
    expect(validateDealSave({ name: "Acme", stage: "Nurture (Q1)", lostReason: " " })).toBe("Pick a lost or stalled reason, and note what they said.");
    expect(validateDealSave({ name: "Acme", stage: "Lost", lostReason: "Price" })).toBe("");
  });
});

describe("stage auto-advance", () => {
  it("each activity moves the deal forward to its stage", () => {
    expect(nextStage("Replied", { type: "Proposal sent" })).toBe("Proposal sent");
    expect(nextStage("Meeting booked", { type: "Meeting held" })).toBe("Discovery done");
    expect(nextStage("Replied", { type: "Meeting booked" })).toBe("Meeting booked");
    expect(nextStage("Contacted", { type: "Email", direction: "Inbound", outcome: "Positive" })).toBe("Replied");
    expect(nextStage("Target", { type: "Call", direction: "Outbound" })).toBe("Contacted");
  });

  it("never moves backwards or sideways, including exactly at the target stage", () => {
    expect(nextStage("Proposal sent", { type: "Proposal sent" })).toBeNull();
    expect(nextStage("Verbal yes", { type: "Meeting held" })).toBeNull();
    expect(nextStage("Discovery done", { type: "Meeting booked" })).toBeNull();
    expect(nextStage("Replied", { type: "Email", direction: "Inbound", outcome: "Positive" })).toBeNull();
    expect(nextStage("Contacted", { type: "Call", direction: "Outbound" })).toBeNull();
  });

  it("never moves Signed or Lost, and ignores notes and negative replies", () => {
    expect(nextStage("Signed", { type: "Proposal sent" })).toBeNull();
    expect(nextStage("Lost", { type: "Meeting held" })).toBeNull();
    expect(nextStage("Target", { type: "Note", direction: "Outbound" })).toBeNull();
    expect(nextStage("Contacted", { type: "Email", direction: "Inbound", outcome: "Negative" })).toBeNull();
  });

  it("asks for a next step when the deal ends up open", () => {
    expect(needsNextStep("Target", { type: "Call", direction: "Outbound" })).toBe(true);
    expect(needsNextStep("Target", { type: "Note" })).toBe(false);
    expect(needsNextStep("Signed", { type: "Call", direction: "Outbound" })).toBe(false);
  });
});

describe("import duplicate matching", () => {
  const match = importMatcher({
    companies: [{ id: "c1", name: "Acme PEO, LLC", domain: "acmepeo.example" }, { id: "c2", name: "Beta Payroll" }],
    clients: [{ id: "k1", name: "Client Co", domain: "clientco.example" }],
    contactEmails: ["Pat@AcmePEO.example"]
  });

  it("matches by domain from the website, then by normalized name", () => {
    expect(match({ name: "Totally Different", website: "https://www.acmepeo.example/about" })).toEqual({ action: "update", companyId: "c1", key: "acmepeo.example", contactIsNew: false });
    expect(match({ name: "The Beta Payroll Inc" })).toEqual({ action: "update", companyId: "c2", key: "n:beta payroll", contactIsNew: false });
  });

  it("uses the email's domain when there is no website, but not free mail", () => {
    expect(match({ name: "Acme", email: "new@acmepeo.example" })).toMatchObject({ action: "update", companyId: "c1", contactIsNew: true });
    expect(match({ name: "Gamma HR", email: "owner@gmail.com" })).toEqual({ action: "add", key: "n:gamma hr", contactIsNew: true });
  });

  it("an existing contact does not stop the company row", () => {
    expect(match({ name: "Acme", email: "PAT@acmepeo.example" })).toMatchObject({ action: "update", contactIsNew: false });
  });

  it("skips rows with no name or website, and existing clients by domain or name", () => {
    expect(match({ email: "x@gmail.com" })).toEqual({ action: "skip", reason: "no-name-or-website" });
    expect(match({ name: "Anything", website: "clientco.example" })).toEqual({ action: "skip", reason: "existing-client" });
    expect(match({ name: "Client Co Inc." })).toEqual({ action: "skip", reason: "existing-client" });
  });

  it("a domain-only row matches an existing company by domain", () => {
    expect(match({ website: "acmepeo.example" })).toMatchObject({ action: "update", companyId: "c1" });
    expect(match({ website: "new.example" })).toEqual({ action: "add", key: "new.example", contactIsNew: false });
  });
});

describe("proposal revisions", () => {
  it("a draft can take a new version; a sent proposal cannot", () => {
    expect(canAddProposalVersion({ status: "Draft" })).toBe(true);
    expect(canAddProposalVersion({ status: "Sent" })).toBe(false);
  });
});
