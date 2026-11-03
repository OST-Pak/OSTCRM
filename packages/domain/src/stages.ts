import { daysBetween, datePart } from "./dates.js";
import { OPEN_STAGES, STAGES, STAGE_SLA } from "./defaults.js";
import type { Activity, Company, IsoDate, Stage } from "./types.js";

export const isOpenStage = (s: Stage): boolean => OPEN_STAGES.includes(s);

export const stageIndex = (s: Stage): number => STAGES.indexOf(s);

/** The date the deal entered its current stage. Falls back to the created date, then today. */
export function stageSince(c: Company, today: IsoDate): IsoDate {
  return c.stageChangedAt || datePart(c.createdAt) || today;
}

/** How many touches an activity row stands for. Missing means 1; an explicit 0 means 0; never negative. */
export function touchCount(a: Pick<Activity, "count">): number {
  if (a.count === 0 || a.count === "0") return 0;
  return Math.max(0, Number(a.count) || 1);
}

/** Activity types that are bookkeeping, not a touch on the account. */
const NOT_A_TOUCH: ReadonlySet<string> = new Set(["Stage change", "Contacts sequenced", "Meeting booked"]);

/** Latest touch date per company. */
export function lastTouchByCompany(activities: readonly Activity[]): Map<string, IsoDate> {
  const m = new Map<string, IsoDate>();
  for (const a of activities) {
    if (!a.companyId || NOT_A_TOUCH.has(a.type)) continue;
    const prev = m.get(a.companyId);
    if (!prev || a.date > prev) m.set(a.companyId, a.date);
  }
  return m;
}

export type HealthLevel = "good" | "warn" | "bad";
export interface DealHealth { level: HealthLevel; reasons: string[] }

/**
 * Red: no next step, next step overdue, stage SLA breached, or no decision date from Proposal sent on.
 * Amber: no activity logged, or no touch in 5 days or more. Closed and not-started deals are always good.
 */
export function dealHealth(
  c: Company,
  lastTouch: IsoDate | undefined,
  today: IsoDate,
  sla = STAGE_SLA
): DealHealth {
  if (!isOpenStage(c.stage)) return { level: "good", reasons: [] };
  const red: string[] = [];
  const amber: string[] = [];
  if (!c.nextStep || !c.nextStepDate) red.push("No next step");
  else if (c.nextStepDate < today) red.push(`Next step overdue (${c.nextStepDate})`);
  const rule = sla[c.stage];
  const inStage = daysBetween(stageSince(c, today), today);
  if (rule && inStage > rule.days) red.push(`${rule.reason} (${inStage}d in stage)`);
  if (stageIndex(c.stage) >= stageIndex("Proposal sent") && !c.decisionDate) red.push("No decision date");
  if (!lastTouch) amber.push("No activity logged");
  else {
    const d = daysBetween(lastTouch, today);
    if (d >= 5) amber.push(`No touch in ${d} days`);
  }
  return { level: red.length ? "bad" : amber.length ? "warn" : "good", reasons: [...red, ...amber] };
}
