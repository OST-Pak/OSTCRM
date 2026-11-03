import { daysBetween } from "./dates.js";
import { DEFAULT_PLAN, type PlanConfig } from "./defaults.js";
import { touchCount } from "./stages.js";
import type { Activity, Company, IsoDate } from "./types.js";

export type PaceMetric = "meetings" | "proposals" | "signed";

/** Cumulative plan target on `date`, interpolated linearly between plan dates. */
export function planAt(metric: PaceMetric, date: IsoDate, plan: PlanConfig = DEFAULT_PLAN): number {
  const ds = plan.dates;
  const v = plan[metric];
  if (!ds.length || date <= ds[0]!) return 0;
  for (let i = 1; i < ds.length; i++) {
    if (date <= ds[i]!) {
      const span = daysBetween(ds[i - 1]!, ds[i]!) || 1;
      return v[i - 1]! + (v[i]! - v[i - 1]!) * daysBetween(ds[i - 1]!, date) / span;
    }
  }
  return v[v.length - 1]!;
}

/** Actual cumulative count on `date`. Signed counts companies by signed date; the others count activities since the plan start. */
export function actualAt(
  metric: PaceMetric,
  date: IsoDate,
  data: { companies: readonly Pick<Company, "signedAt">[]; activities: readonly Activity[] },
  plan: PlanConfig = DEFAULT_PLAN
): number {
  if (metric === "signed") return data.companies.filter(c => c.signedAt && c.signedAt <= date).length;
  const type = metric === "meetings" ? "Meeting held" : "Proposal sent";
  return data.activities
    .filter(a => a.type === type && a.date <= date && a.date >= plan.start)
    .reduce((s, a) => s + touchCount(a), 0);
}

export type PaceStatus = "ahead" | "too-early" | "on-pace" | "slightly-behind" | "behind";

/** Under 0.75 expected, any result counts as ahead; otherwise on pace at 100%, slightly behind from 70%. */
export function paceStatus(actual: number, expected: number): PaceStatus {
  if (expected < 0.75) return actual > 0 ? "ahead" : "too-early";
  const r = actual / expected;
  if (r >= 1) return "on-pace";
  if (r >= 0.7) return "slightly-behind";
  return "behind";
}
