/**
 * Deal edits and activity effects, ported from the live artifact's drawer (`#coform` save and `logActivity`).
 * The API calls these; the database stores what they return.
 */
import { OPEN_STAGES } from "./defaults.js";
import { nextStage, needsNextStep } from "./registry.js";
import type { IsoDate, Stage } from "./types.js";

export const COMPANY_TYPES = ["PEO", "ASO", "EOR", "Payroll only", "PEO broker", "PrismHR consultant", "Staffing agency", "CPA firm", "Existing client", "Other"] as const;
export const CHANNELS = ["Existing client", "Warm network", "Referral partner", "Cold email", "Calls", "LinkedIn"] as const;
export const PLATFORMS = ["PrismHR", "isolved", "ADP", "Paylocity", "Enwage", "Other", "Unknown"] as const;
/** Activity types a person can log. "Stage change" is written by the system, as a stage event. */
export const LOGGABLE_ACTIVITY_TYPES = ["Email", "Call", "WhatsApp", "LinkedIn", "Meeting booked", "Meeting held", "Proposal sent", "Note", "Contacts sequenced"] as const;
export const OUTCOMES = ["Positive", "Neutral", "Negative", "No answer"] as const;
export const FITS = ["Fit", "Review", "Partner", "Not a fit"] as const;
export const LOST_REASONS = ["Price", "Timing", "Chose another provider", "Kept in-house", "Prefer local hire", "Data security", "Time zone or coverage", "No response", "Not a fit", "Other"] as const;
export const COMPETING_OPTIONS = ["In-house hire", "Other BPO", "Do nothing", "Other"] as const;
export const PILOT_STATUSES = ["Proposed", "Running", "Converted", "Ended"] as const;
export const CONTACT_ROLES = ["Signer", "Champion", "Finance", "User", "Referral source"] as const;

/** Dates that move when a saved deal changes stage, as the artifact sets them. */
export function stageDatesOnSave(prev: { stage: Stage; signedOn: IsoDate | null }, nextStageValue: Stage, today: IsoDate):
  { stageChangedOn?: IsoDate; signedOn?: IsoDate | null } {
  if (prev.stage === nextStageValue) return {};
  const out: { stageChangedOn?: IsoDate; signedOn?: IsoDate | null } = { stageChangedOn: today };
  if (nextStageValue === "Signed" && !prev.signedOn) out.signedOn = today;
  if (nextStageValue !== "Signed" && prev.signedOn) out.signedOn = null;
  return out;
}

export interface LoggedActivity {
  type: string;
  direction?: "Inbound" | "Outbound" | null;
  outcome?: string | null;
  occurredOn: IsoDate;
  nextStep?: string | null;
  nextStepOn?: IsoDate | null;
}

export interface ActivityEffect {
  /** Why the activity can't be logged, or "". */
  error: string;
  stage?: Stage;
  nextStep?: string;
  nextStepOn?: IsoDate | null;
  proposalSentOn?: IsoDate;
}

/**
 * What logging an activity does to its deal: auto-advance the stage, record the first proposal date,
 * and carry the next step. When the deal stays open, a next step with a date that is not in the past is required.
 */
export function activityEffect(deal: { stage: Stage; proposalSentOn: IsoDate | null } | null, a: LoggedActivity, today: IsoDate): ActivityEffect {
  if (!deal) return { error: "" };
  const rec = { type: a.type, direction: a.direction ?? undefined, outcome: (a.outcome ?? "") as "" };
  if (needsNextStep(deal.stage, rec)) {
    if (!String(a.nextStep ?? "").trim() || !a.nextStepOn) return { error: "This deal is open, so it needs a next step and a date." };
    if (a.nextStepOn < today) return { error: "The next step date can't be in the past." };
  }
  const out: ActivityEffect = { error: "" };
  const s = nextStage(deal.stage, rec);
  if (s) out.stage = s;
  if (a.type === "Proposal sent" && !deal.proposalSentOn) out.proposalSentOn = a.occurredOn;
  if (String(a.nextStep ?? "").trim()) { out.nextStep = String(a.nextStep).trim(); out.nextStepOn = a.nextStepOn || null; }
  return out;
}

/** Whether a stage counts as an open deal (needs a next step). */
export const isOpen = (s: Stage): boolean => OPEN_STAGES.includes(s);
