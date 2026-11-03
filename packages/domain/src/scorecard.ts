import { addDays, weekStart, weekday } from "./dates.js";
import {
  CONVERSATION_TYPES, DEFAULT_SETUP_UNTIL, DEFAULT_WEEKLY_TARGETS, PARTNER_TYPES,
  type WeeklyMetricId, type WeeklyTarget
} from "./defaults.js";
import { touchCount } from "./stages.js";
import type { Activity, Company, IsoDate } from "./types.js";

type Rule = (a: Activity, c: Company | undefined) => boolean;

/** Which activities count toward each weekly metric. Rules live in code; targets live in config. */
export const WEEKLY_RULES: Readonly<Record<WeeklyMetricId, Rule>> = {
  warmConversations: (a, c) => CONVERSATION_TYPES.has(a.type) && !!c && (c.channel === "Existing client" || c.channel === "Warm network"),
  partnerConversations: (a, c) => CONVERSATION_TYPES.has(a.type) && !!c && (c.channel === "Referral partner" || PARTNER_TYPES.has(String(c.type))),
  contactsSequenced: a => a.type === "Contacts sequenced",
  dials: a => a.type === "Call" && a.direction !== "Inbound",
  positiveReplies: a => a.direction === "Inbound" && a.outcome === "Positive",
  meetingsHeld: a => a.type === "Meeting held",
  proposalsSent: a => a.type === "Proposal sent"
};

export type WeeklyStatus = "setup" | "not-started" | "on-pace" | "behind" | "red";

export interface WeeklyRow {
  id: WeeklyMetricId;
  label: string;
  owner: string;
  actual: number;
  target: number;
  status: WeeklyStatus;
  /** The metric's start date when status is "not-started". */
  startsOn?: IsoDate;
}

/**
 * This week's scorecard (Monday to Sunday). Targets are pro-rated by working days elapsed,
 * Monday = 1 up to Friday and the weekend = 5. At or above the pro-rated target is on pace,
 * at or above the pro-rated red line is behind, below it is red.
 */
export function weeklyScorecard(input: {
  activities: readonly Activity[];
  companiesById: ReadonlyMap<string, Company>;
  today: IsoDate;
  targets?: readonly WeeklyTarget[];
  setupUntil?: IsoDate;
}): WeeklyRow[] {
  const { activities, companiesById, today } = input;
  const targets = input.targets ?? DEFAULT_WEEKLY_TARGETS;
  const setupUntil = input.setupUntil ?? DEFAULT_SETUP_UNTIL;
  const ws = weekStart(today);
  const we = addDays(ws, 6);
  const elapsed = Math.min(5, weekday(today) + 1);
  const week = activities.filter(a => a.date >= ws && a.date <= we);
  return targets.map(t => {
    const rule = WEEKLY_RULES[t.id];
    const actual = week.filter(a => rule(a, a.companyId ? companiesById.get(a.companyId) : undefined)).reduce((s, a) => s + touchCount(a), 0);
    const base = { id: t.id, label: t.label, owner: t.owner, actual, target: t.target };
    if (today < setupUntil) return { ...base, status: "setup" as const };
    if (t.from && we < t.from) return { ...base, status: "not-started" as const, startsOn: t.from };
    const need = t.target * elapsed / 5;
    const redNeed = t.red * elapsed / 5;
    const status: WeeklyStatus = actual >= need ? "on-pace" : actual >= redNeed ? "behind" : "red";
    return { ...base, status };
  });
}
