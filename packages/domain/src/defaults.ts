/**
 * Values ported from the live artifact CRM (version 30, Nov 2, 2026).
 * Each becomes an owner-editable, effective-dated config row at migration
 * (config_pricing, config_plan, config_targets, config_cadence, ...).
 * Domain functions take these as arguments; nothing reads this file implicitly.
 */
import type { IsoDate, Stage } from "./types.js";

export const STAGES: readonly Stage[] = [
  "Target", "Contacted", "Replied", "Meeting booked", "Discovery done",
  "Proposal sent", "Verbal yes", "Signed", "Nurture (Q1)", "Lost"
];

export const OPEN_STAGES: readonly Stage[] = [
  "Contacted", "Replied", "Meeting booked", "Discovery done", "Proposal sent", "Verbal yes"
];

/** Stages shown on the pipeline board. */
export const PIPELINE_STAGES: readonly Stage[] = [...OPEN_STAGES, "Signed"];

/** Probability that a deal at this stage signs. */
export const STAGE_PROBABILITY: Readonly<Record<Stage, number>> = {
  "Target": 0, "Contacted": 0.02, "Replied": 0.05, "Meeting booked": 0.1, "Discovery done": 0.2,
  "Proposal sent": 0.35, "Verbal yes": 0.7, "Signed": 1, "Nurture (Q1)": 0, "Lost": 0
};

/** Days a deal may sit in a stage before it is flagged, and the flag text. */
export const STAGE_SLA: Readonly<Partial<Record<Stage, { days: number; reason: string }>>> = {
  "Contacted": { days: 7, reason: "No reply in 7 days: change angle or channel" },
  "Replied": { days: 2, reason: "Reply not turned into a meeting" },
  "Meeting booked": { days: 7, reason: "Meeting not held in 7 days" },
  "Discovery done": { days: 2, reason: "Proposal overdue" },
  "Proposal sent": { days: 5, reason: "Decision call overdue" },
  "Verbal yes": { days: 5, reason: "Signature overdue" }
};

export interface Pricing {
  /** Monthly price per staff seat, in cents. */
  staffSeatCents: number;
  /** Monthly price per manager seat, in cents. */
  managerSeatCents: number;
}

/** Standard list prices only. Client-specific pricing never goes in code. */
export const DEFAULT_PRICING: Pricing = { staffSeatCents: 220_000, managerSeatCents: 320_000 };

export interface PlanConfig {
  start: IsoDate;
  end: IsoDate;
  deadline: IsoDate;
  /** Cumulative targets at each date, interpolated linearly between dates. */
  dates: IsoDate[];
  meetings: number[];
  proposals: number[];
  signed: number[];
}

export const DEFAULT_PLAN: PlanConfig = {
  start: "2026-10-29",
  end: "2026-12-27",
  deadline: "2026-12-11",
  dates: ["2026-10-29", "2026-11-01", "2026-11-06", "2026-11-13", "2026-11-20", "2026-11-25", "2026-12-04", "2026-12-11", "2026-12-18", "2026-12-27"],
  meetings: [0, 0, 2, 8, 12, 14, 18, 20, 22, 22],
  proposals: [0, 0, 1, 2, 5, 6, 9, 10, 11, 11],
  signed: [0, 0, 0, 0, 0, 1, 2, 3, 4, 4]
};

/** US holidays the team does not work during the push. */
export const DEFAULT_OFF_DAYS: ReadonlySet<IsoDate> = new Set(["2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25"]);

export type WeeklyMetricId =
  | "warmConversations"
  | "partnerConversations"
  | "contactsSequenced"
  | "dials"
  | "positiveReplies"
  | "meetingsHeld"
  | "proposalsSent";

export interface WeeklyTarget {
  id: WeeklyMetricId;
  label: string;
  owner: string;
  target: number;
  /** Below this pro-rated level the metric is red. */
  red: number;
  /** The metric is not scored in weeks ending before this date. */
  from?: IsoDate;
}

export const DEFAULT_WEEKLY_TARGETS: readonly WeeklyTarget[] = [
  { id: "warmConversations", label: "Warm and client conversations", owner: "Saad", target: 15, red: 8 },
  { id: "partnerConversations", label: "Partner conversations", owner: "Saad", target: 5, red: 2 },
  { id: "contactsSequenced", label: "New contacts sequenced", owner: "Saad", target: 300, red: 150, from: "2026-11-09" },
  { id: "dials", label: "Dials", owner: "Saad", target: 150, red: 75 },
  { id: "positiveReplies", label: "Positive replies", owner: "Saad", target: 3, red: 1 },
  { id: "meetingsHeld", label: "Discovery meetings held", owner: "Saad", target: 4, red: 2, from: "2026-11-09" },
  { id: "proposalsSent", label: "Proposals sent", owner: "Saad", target: 2, red: 1, from: "2026-11-16" }
];

/** Weeks ending before this date show "Setup week" instead of a status. */
export const DEFAULT_SETUP_UNTIL: IsoDate = "2026-11-02";

export interface ForecastAssumptions {
  targetContracts: number;
  targetMrrLowCents: number;
  targetMrrHighCents: number;
  /** Percent of contacts sequenced that reply positively. */
  replyRate: number;
  replyToMeeting: number;
  meetingToProposal: number;
  proposalToSigned: number;
  /** Days from first meeting to signature. */
  cycleDays: number;
  /** How many eligible accounts are tier A, then tier B. */
  tierA: number;
  tierB: number;
}

export const DEFAULT_FORECAST: ForecastAssumptions = {
  targetContracts: 3, targetMrrLowCents: 1_800_000, targetMrrHighCents: 2_000_000,
  replyRate: 1, replyToMeeting: 60, meetingToProposal: 50, proposalToSigned: 35,
  cycleDays: 21, tierA: 40, tierB: 160
};

export type CadenceChannel = "Email" | "LinkedIn" | "Call" | "Task" | "Proposal";
export interface CadenceStep { day: number; channel: CadenceChannel; action: string }

export const DEFAULT_CADENCE: Readonly<Partial<Record<Stage, readonly CadenceStep[]>>> = {
  "Contacted": [
    { day: 0, channel: "Email", action: "Send the first email: one pain, one ask" },
    { day: 0, channel: "LinkedIn", action: "Connect with a short note" },
    { day: 2, channel: "Call", action: "Call; if no answer, leave a 20-second voicemail" },
    { day: 4, channel: "Email", action: "Follow-up email with a new angle (year-end surge or cost)" },
    { day: 7, channel: "Call", action: "Second call; try another contact at the company" },
    { day: 10, channel: "Email", action: "Close-the-loop email; no reply means Nurture (Q1)" }
  ],
  "Replied": [
    { day: 0, channel: "Email", action: "Reply within 2 hours with two meeting times" },
    { day: 1, channel: "Call", action: "Call to lock the meeting" },
    { day: 2, channel: "Email", action: "Last nudge with a calendar link" }
  ],
  "Meeting booked": [
    { day: 0, channel: "Email", action: "Send the invite and a 3-line agenda" },
    { day: 0, channel: "Task", action: "Prep: platform, size, triggers, who attends" },
    { day: 1, channel: "Email", action: "Confirm the day before; attach the security one-pager if asked" }
  ],
  "Discovery done": [
    { day: 0, channel: "Email", action: "Recap email: their pain in their words, scope, next step" },
    { day: 0, channel: "Task", action: "Scope seats and roles with Waqas" },
    { day: 1, channel: "Proposal", action: "Build and send the proposal from the template" }
  ],
  "Proposal sent": [
    { day: 0, channel: "Call", action: "Book the decision call" },
    { day: 2, channel: "Email", action: "Check in: answer questions, restate the start date" },
    { day: 5, channel: "Call", action: "Decision call: ask for the yes or the blocker" },
    { day: 7, channel: "Email", action: "Offer the 30-day paid pilot if they stall" },
    { day: 10, channel: "Call", action: "Escalate to the owner or CEO and set a final decision date" }
  ],
  "Verbal yes": [
    { day: 0, channel: "Email", action: "Send the agreement the same day" },
    { day: 2, channel: "Call", action: "Confirm signature and the onboarding start date" },
    { day: 4, channel: "Task", action: "Awais chases the signature; Abdullah readies onboarding" }
  ],
  "Signed": [
    { day: 0, channel: "Task", action: "Kickoff call and access setup with Abdullah" },
    { day: 7, channel: "Call", action: "Week-one check-in; ask for a referral" }
  ]
};

/** Days after a stage change that each document falls due. */
export interface DocumentSla { proposalDays: number; contractDays: number; decisionDays: number; signatureDays: number }
export const DEFAULT_DOCUMENT_SLA: DocumentSla = { proposalDays: 2, contractDays: 1, decisionDays: 5, signatureDays: 3 };

export const PARTNER_TYPES: ReadonlySet<string> = new Set(["PEO broker", "PrismHR consultant", "CPA firm"]);

/** Activity types that count as a real conversation on the scorecard. */
export const CONVERSATION_TYPES: ReadonlySet<string> = new Set(["Email", "Call", "WhatsApp", "LinkedIn", "Meeting held"]);

/** Platforms where an Enwage conversation may be worth raising. */
export const DEFAULT_ENWAGE_PLATFORMS: ReadonlySet<string> = new Set([
  "isolved", "PRO Software", "PayPlus", "Self-hosted (unnamed)", "Darwinet", "Worklio", "Payentry", "Millennium", "Proprietary"
]);

export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "live.com", "msn.com",
  "comcast.net", "me.com", "proton.me", "protonmail.com"
]);

/** Days after which a verified fact is stale, and a buying trigger stops counting. */
export const STALE_DAYS = 90;
export const TRIGGER_DAYS = 120;

export const OBJECTIONS: readonly string[] = [
  "Price", "Data security", "Time zone or coverage", "Prefer local hire", "Already outsourced", "Timing",
  "PrismHR access or permissions", "Quality or error risk", "Other"
];

export const OFFERS: readonly string[] = ["Year-end surge", "PEO back-office team", "30-day pilot", "Finance & Accounting", "AI automation"];
