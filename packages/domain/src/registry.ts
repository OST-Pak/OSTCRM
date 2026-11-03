/**
 * Rules from the "Business rules registry" in "Oak Street BD CRM: Build Instructions for Claude"
 * that were not yet ported: save validation, stage auto-advance, import duplicate matching, and
 * proposal revisions. Ported from the live artifact (v30): `nextStage`, `needsNextStep`, the prospect
 * form checks and the import plan.
 */
import { domainOf, isFreeMail, normalizeCompanyName, normalizeEmail } from "./accounts.js";
import { CONVERSATION_TYPES, OPEN_STAGES, STAGES } from "./defaults.js";
import { monthlyValueCents } from "./money.js";
import type { Activity, Company, Stage } from "./types.js";

const idx = (s: Stage) => STAGES.indexOf(s);

// ---------- save validation ----------

export interface DealDraft extends Pick<Company, "name" | "stage" | "nextStep" | "nextStepDate" | "staffSeats" | "managerSeats"> {
  /** Proposal value in cents, when entered by hand instead of seats. */
  proposalValueCents?: number | null;
  /** Lost or stalled reason. */
  lostReason?: string | null;
}

/**
 * Returns the first problem that blocks saving, or "" when the record can be saved.
 * Name required. Open deals need a next step and date. Proposal sent to Signed needs a value or seats.
 * Signed needs seats. Lost or Nurture needs a reason.
 */
export function validateDealSave(d: DealDraft): string {
  if (!String(d.name ?? "").trim()) return "Company name is required.";
  if (OPEN_STAGES.includes(d.stage) && (!String(d.nextStep ?? "").trim() || !d.nextStepDate)) return "Open deals need a next step and a date.";
  const value = monthlyValueCents(d);
  if (idx(d.stage) >= idx("Proposal sent") && idx(d.stage) <= idx("Signed") && !(Number(d.proposalValueCents) > 0 || value > 0)) {
    return "Enter the proposal value or the seats before moving to this stage.";
  }
  if (d.stage === "Signed" && !value) return "Signed deals need staff or manager seats.";
  if ((d.stage === "Lost" || d.stage === "Nurture (Q1)") && !String(d.lostReason ?? "").trim()) return "Pick a lost or stalled reason, and note what they said.";
  return "";
}

// ---------- stage auto-advance ----------

/**
 * The stage an activity moves a deal to, or null. Never moves Signed or Lost, never moves backwards.
 * Proposal sent moves to Proposal sent; Meeting held to Discovery done; Meeting booked to Meeting booked;
 * a positive inbound reply to Replied; the first outbound conversation from Target to Contacted.
 */
export function nextStage(current: Stage, a: Pick<Activity, "type" | "direction" | "outcome">): Stage | null {
  if (current === "Lost" || current === "Signed") return null;
  const i = idx(current);
  if (a.type === "Proposal sent" && i < idx("Proposal sent")) return "Proposal sent";
  if (a.type === "Meeting held" && i < idx("Discovery done")) return "Discovery done";
  if (a.type === "Meeting booked" && i < idx("Meeting booked")) return "Meeting booked";
  if (a.direction === "Inbound" && a.outcome === "Positive" && i < idx("Replied")) return "Replied";
  if (a.direction === "Outbound" && current === "Target" && CONVERSATION_TYPES.has(a.type)) return "Contacted";
  return null;
}

/** Whether logging this activity leaves the deal in an open stage, so the form must ask for a next step. */
export function needsNextStep(current: Stage, a: Pick<Activity, "type" | "direction" | "outcome">): boolean {
  return OPEN_STAGES.includes(nextStage(current, a) ?? current);
}

// ---------- import duplicate matching ----------

export interface KnownCompany { id: string; name: string; domain?: string | null }
export interface ImportRow { name?: string; website?: string; email?: string }

export type ImportMatch =
  | { action: "skip"; reason: "no-name-or-website" | "existing-client" }
  | { action: "update"; companyId: string; key: string; contactIsNew: boolean }
  | { action: "add"; key: string; contactIsNew: boolean };

/**
 * Indexes existing companies and clients once, then classifies each import row.
 * The company domain comes from the website, else from the contact's email unless it is free mail.
 * Rows with no name and no domain are skipped. Existing clients are never imported as prospects.
 * A company matches by domain first, then by normalized name. The row's contact is new only if it has an
 * email that is not already in the CRM; an existing contact does not stop the company row.
 * Rows with the same key in one file group into one company.
 */
export function importMatcher(input: { companies: readonly KnownCompany[]; clients: readonly KnownCompany[]; contactEmails: Iterable<string> }) {
  const byDomain = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const c of input.companies) {
    if (c.domain) byDomain.set(c.domain, c.id);
    const n = normalizeCompanyName(c.name);
    if (n && !byName.has(n)) byName.set(n, c.id);
  }
  const clientDomains = new Set(input.clients.map(c => c.domain).filter((d): d is string => !!d));
  const clientNames = new Set(input.clients.map(c => normalizeCompanyName(c.name)).filter(Boolean));
  const emails = new Set([...input.contactEmails].map(normalizeEmail));

  return (row: ImportRow): ImportMatch => {
    const name = String(row.name ?? "").trim();
    const email = row.email ? normalizeEmail(row.email) : "";
    let domain = domainOf(row.website);
    const emailDomain = domainOf(email);
    if (!domain && emailDomain && !isFreeMail(emailDomain)) domain = emailDomain;
    if (!name && !domain) return { action: "skip", reason: "no-name-or-website" };
    const norm = normalizeCompanyName(name);
    if ((domain && clientDomains.has(domain)) || (norm && clientNames.has(norm))) return { action: "skip", reason: "existing-client" };
    const contactIsNew = !!email && !emails.has(email);
    const key = domain || `n:${norm}`;
    const existing = (domain && byDomain.get(domain)) || byName.get(norm || normalizeCompanyName(domain)) || null;
    return existing ? { action: "update", companyId: existing, key, contactIsNew } : { action: "add", key, contactIsNew };
  };
}

// ---------- proposals ----------

/** A sent version is locked; a revision after sending is a new proposal, not a new version. */
export function canAddProposalVersion(p: { status: "Draft" | "Sent" | string }): boolean {
  return p.status !== "Sent";
}
