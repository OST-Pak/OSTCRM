import { addDays, workdays } from "./dates.js";
import { DEFAULT_FORECAST, DEFAULT_OFF_DAYS, DEFAULT_PLAN, STAGE_PROBABILITY, type ForecastAssumptions, type PlanConfig } from "./defaults.js";
import { monthlyValueCents } from "./money.js";
import { actualAt } from "./pace.js";
import { isOpenStage, touchCount } from "./stages.js";
import type { Activity, Company, IsoDate } from "./types.js";

export interface Funnel {
  /** Contacts sequenced since the plan start. */
  sequenced: number;
  positiveReplies: number;
  meetingsHeld: number;
  proposalsSent: number;
  signed: number;
}

/** Measured funnel to date. `outreachEnrolled` counts outreach records not already logged as a "Contacts sequenced" activity. */
export function measuredFunnel(input: {
  companies: readonly Company[];
  activities: readonly Activity[];
  outreachEnrolled: number;
  today: IsoDate;
  plan?: PlanConfig;
}): Funnel {
  const plan = input.plan ?? DEFAULT_PLAN;
  const since = input.activities.filter(a => a.date >= plan.start);
  const sum = (f: (a: Activity) => boolean) => since.filter(f).reduce((s, a) => s + touchCount(a), 0);
  const data = { companies: input.companies, activities: input.activities };
  return {
    sequenced: sum(a => a.type === "Contacts sequenced") + input.outreachEnrolled,
    positiveReplies: sum(a => a.direction === "Inbound" && a.outcome === "Positive"),
    meetingsHeld: actualAt("meetings", input.today, data, plan),
    proposalsSent: actualAt("proposals", input.today, data, plan),
    signed: actualAt("signed", input.today, data, plan)
  };
}

export interface Rate { value: number; source: "measured" | "assumed"; numerator?: number; denominator?: number }

/** Use the measured rate once the denominator reaches `minDenominator`, otherwise the assumed percent. */
export function conversionRate(numerator: number, denominator: number, minDenominator: number, assumedPercent: number): Rate {
  return denominator >= minDenominator
    ? { value: numerator / denominator, source: "measured", numerator, denominator }
    : { value: assumedPercent / 100, source: "assumed" };
}

export type ForecastStatus = "covered" | "closable" | "short";

export interface Forecast {
  expectedContracts: number;
  expectedMonthlyCents: number;
  gap: number;
  status: ForecastStatus;
  lastDayToBook: IsoDate;
  /** Working days from today to the last day to book (at least 1). */
  workdaysLeft: number;
  rates: { replyRate: Rate; replyToMeeting: Rate; meetingToProposal: Rate; proposalToSigned: Rate };
  /** Totals needed to close the gap, rounded up. Zero when the gap is covered. */
  needed: { sequenced: number; positiveReplies: number; meetingsHeld: number; proposalsSent: number };
  /** The same, per 5-day week over the working days left. */
  neededPerWeek: { sequenced: number; positiveReplies: number; meetingsHeld: number; proposalsSent: number };
}

/** Round up, tolerating float noise; never returns -0. */
const ceil = (x: number) => Math.max(0, Math.ceil(x - 1e-9));

/**
 * Weighted pipeline forecast to the deadline. Signed deals count 1; open deals count their stage probability.
 * Measured rates replace assumptions once 3 deals reach the step (200 contacts for the reply rate).
 */
export function forecast(input: {
  companies: readonly Company[];
  funnel: Funnel;
  today: IsoDate;
  assumptions?: ForecastAssumptions;
  plan?: PlanConfig;
  offDays?: ReadonlySet<IsoDate>;
  pricing?: Parameters<typeof monthlyValueCents>[1];
}): Forecast {
  const f = input.assumptions ?? DEFAULT_FORECAST;
  const plan = input.plan ?? DEFAULT_PLAN;
  const m = input.funnel;
  const signed = input.companies.filter(c => c.stage === "Signed");
  const open = input.companies.filter(c => isOpenStage(c.stage));
  const expectedContracts = signed.length + open.reduce((s, c) => s + STAGE_PROBABILITY[c.stage], 0);
  const expectedMonthlyCents = Math.round(
    signed.reduce((s, c) => s + monthlyValueCents(c, input.pricing), 0) +
    open.reduce((s, c) => s + monthlyValueCents(c, input.pricing) * STAGE_PROBABILITY[c.stage], 0)
  );
  const gap = Math.max(0, f.targetContracts - expectedContracts);
  const rates = {
    proposalToSigned: conversionRate(m.signed, m.proposalsSent, 3, f.proposalToSigned),
    meetingToProposal: conversionRate(m.proposalsSent, m.meetingsHeld, 3, f.meetingToProposal),
    replyToMeeting: conversionRate(m.meetingsHeld, m.positiveReplies, 3, f.replyToMeeting),
    replyRate: conversionRate(m.positiveReplies, m.sequenced, 200, f.replyRate)
  };
  const lastDayToBook = addDays(plan.deadline, -f.cycleDays);
  const workdaysLeft = Math.max(1, workdays(input.today, lastDayToBook < input.today ? input.today : lastDayToBook, input.offDays ?? DEFAULT_OFF_DAYS));
  const proposalsSent = gap / Math.max(0.01, rates.proposalToSigned.value);
  const meetingsHeld = proposalsSent / Math.max(0.01, rates.meetingToProposal.value);
  const positiveReplies = meetingsHeld / Math.max(0.01, rates.replyToMeeting.value);
  const sequenced = positiveReplies / Math.max(0.0001, rates.replyRate.value);
  const raw = { sequenced, positiveReplies, meetingsHeld, proposalsSent };
  const needed = { sequenced: ceil(sequenced), positiveReplies: ceil(positiveReplies), meetingsHeld: ceil(meetingsHeld), proposalsSent: ceil(proposalsSent) };
  const perWeek = (x: number) => ceil(x / workdaysLeft * 5);
  const neededPerWeek = {
    sequenced: perWeek(raw.sequenced), positiveReplies: perWeek(raw.positiveReplies),
    meetingsHeld: perWeek(raw.meetingsHeld), proposalsSent: perWeek(raw.proposalsSent)
  };
  const status: ForecastStatus = gap <= 0 ? "covered" : expectedContracts >= f.targetContracts * 0.6 ? "closable" : "short";
  return { expectedContracts, expectedMonthlyCents, gap, status, lastDayToBook, workdaysLeft, rates, needed, neededPerWeek };
}
