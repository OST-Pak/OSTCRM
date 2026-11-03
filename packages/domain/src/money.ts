import { DEFAULT_PRICING, type Pricing } from "./defaults.js";
import type { Company } from "./types.js";

const seats = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** Monthly value of a deal in cents: staff seats and manager seats at list price. */
export function monthlyValueCents(c: Pick<Company, "staffSeats" | "managerSeats">, pricing: Pricing = DEFAULT_PRICING): number {
  return seats(c.staffSeats) * pricing.staffSeatCents + seats(c.managerSeats) * pricing.managerSeatCents;
}

/** `$1,234` from cents, rounded to whole dollars. */
export function formatDollars(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("en-US");
}
