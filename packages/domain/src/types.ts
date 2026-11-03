/** A calendar date as `YYYY-MM-DD`. */
export type IsoDate = string;

export type Stage =
  | "Target"
  | "Contacted"
  | "Replied"
  | "Meeting booked"
  | "Discovery done"
  | "Proposal sent"
  | "Verbal yes"
  | "Signed"
  | "Nurture (Q1)"
  | "Lost";

export type CompanyType =
  | "PEO"
  | "ASO"
  | "EOR"
  | "Payroll only"
  | "PEO broker"
  | "PrismHR consultant"
  | "Staffing agency"
  | "CPA firm"
  | "Existing client"
  | "Other";

export type Channel =
  | "Existing client"
  | "Warm network"
  | "Referral partner"
  | "Cold email"
  | "Calls"
  | "LinkedIn";

export type ActivityType =
  | "Email"
  | "Call"
  | "WhatsApp"
  | "LinkedIn"
  | "Meeting booked"
  | "Meeting held"
  | "Proposal sent"
  | "Note"
  | "Contacts sequenced"
  | "Stage change";

/** The company fields the domain rules read. */
export interface Company {
  id: string;
  name: string;
  stage: Stage;
  type?: CompanyType | string;
  channel?: Channel | string;
  owner?: string;
  fit?: string;
  platform?: string;
  staffSeats?: number;
  managerSeats?: number;
  /** Date the deal entered its current stage. */
  stageChangedAt?: IsoDate;
  createdAt?: string;
  nextStep?: string;
  nextStepDate?: IsoDate;
  decisionDate?: IsoDate;
  signedAt?: IsoDate;
  proposalDueDate?: IsoDate;
  proposalSentDate?: IsoDate;
  contractDueDate?: IsoDate;
  contractSentDate?: IsoDate;
  signatureDueDate?: IsoDate;
  /** Cadence steps ticked off in the current stage. */
  cad?: { stage: Stage; done: number[] };
  enwageLead?: boolean;
  enwageWhy?: string;
}

export interface Activity {
  companyId?: string;
  type: ActivityType | string;
  direction?: "Inbound" | "Outbound" | "";
  outcome?: "" | "Positive" | "Neutral" | "Negative" | "No answer";
  /** Number of touches this row stands for. Missing means 1; an explicit 0 means 0. */
  count?: number | string;
  date: IsoDate;
}

export interface Contact {
  companyId: string;
  title?: string;
  /** A role set by hand overrides the title match. */
  role?: "Signer" | "Champion" | "Finance" | "User" | string;
}
