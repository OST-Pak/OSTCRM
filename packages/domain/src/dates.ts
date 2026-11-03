import type { IsoDate } from "./types.js";

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` to a UTC midnight timestamp. Throws on anything else. */
export function toUtc(d: IsoDate): number {
  const m = ISO.exec(d);
  if (!m) throw new Error(`Not a YYYY-MM-DD date: ${d}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (fromUtc(t) !== d) throw new Error(`Not a real date: ${d}`);
  return t;
}

export function fromUtc(t: number): IsoDate {
  return new Date(t).toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return fromUtc(toUtc(d) + n * DAY_MS);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekday(d: IsoDate): number {
  return (new Date(toUtc(d)).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `d`. */
export function weekStart(d: IsoDate): IsoDate {
  return addDays(d, -weekday(d));
}

/** Working days from `a` to `b` inclusive: Monday to Friday, minus `offDays`. */
export function workdays(a: IsoDate, b: IsoDate, offDays: ReadonlySet<IsoDate> = new Set()): number {
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) if (weekday(d) < 5 && !offDays.has(d)) n++;
  return n;
}

/** The date part of a date or ISO timestamp, or "" when there is none. */
export function datePart(v: string | undefined | null): IsoDate {
  return v ? String(v).slice(0, 10) : "";
}
