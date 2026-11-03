import { coverage, displayType, isPartnerOrClient, isRecentTrigger, tierScore, assignTiers, type Coverage, type Tier } from "./accounts.js";
import { DEFAULT_FORECAST } from "./defaults.js";
import type { Contact, IsoDate, Stage } from "./types.js";

/** One company as the Prospects screen reads it from the database. */
export interface ProspectInput {
  id: string;
  name: string;
  type: string | null;
  classified_type: string | null;
  fit: string | null;
  stage: Stage | null;
  platform: string | null;
  size: "Small" | "Medium" | "Large" | null;
  hiring_signal: "strong" | "weak" | "none" | null;
  research_priority: number | null;
  national: boolean | null;
  duplicate: boolean;
  trigger_dates: string[];
  contacts: Pick<Contact, "role" | "title">[];
}

export interface ProspectRow {
  id: string;
  type: string;
  stage: Stage;
  tier: Tier | null;
  rank: number | null;
  score: number;
  why: string[];
  coverage: Coverage;
  recentTriggers: number;
}

/**
 * Tiers as the artifact computes them: every eligible account is scored, ranked, and the top `tierA` are A,
 * the next `tierB` are B, the rest C. Partners, clients, unfit, closed and duplicate accounts get no tier.
 */
export function rankProspects(rows: readonly ProspectInput[], today: IsoDate, tierA = DEFAULT_FORECAST.tierA, tierB = DEFAULT_FORECAST.tierB): ProspectRow[] {
  const base = rows.map(r => {
    const type = displayType(r);
    const stage: Stage = r.stage ?? "Target";
    const cov = coverage(r.contacts);
    const recentTriggers = r.trigger_dates.filter(d => isRecentTrigger(d, today)).length;
    const eligible = !isPartnerOrClient(r.type ?? undefined) && r.fit !== "Not a fit" && r.fit !== "Partner" && stage !== "Signed" && stage !== "Lost" && !r.duplicate;
    const s = tierScore({ type, platform: r.platform ?? undefined, size: r.size ?? undefined, hiringSignal: r.hiring_signal ?? undefined,
      researchPriority: r.research_priority ?? undefined, national: !!r.national, recentTriggers, coverage: cov, stage });
    return { r, type, stage, cov, recentTriggers, eligible, s };
  });
  const tiers = new Map(assignTiers(base.filter(b => b.eligible).map(b => ({ id: b.r.id, ...b.s })), tierA, tierB).map(t => [t.id, t]));
  return base.map(b => {
    const t = tiers.get(b.r.id);
    return { id: b.r.id, type: b.type, stage: b.stage, tier: t?.tier ?? null, rank: t?.rank ?? null, score: b.s.score, why: b.s.parts, coverage: b.cov, recentTriggers: b.recentTriggers };
  });
}
