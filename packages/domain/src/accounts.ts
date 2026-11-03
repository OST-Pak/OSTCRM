import { daysBetween } from "./dates.js";
import { DEFAULT_ENWAGE_PLATFORMS, FREE_MAIL_DOMAINS, PARTNER_TYPES, STALE_DAYS, TRIGGER_DAYS } from "./defaults.js";
import { isOpenStage } from "./stages.js";
import type { Company, Contact, IsoDate } from "./types.js";

// ---------- normalization and duplicates ----------

/** Bare domain from a URL, email or domain; "" when there is no valid domain. */
export function domainOf(s: string | undefined | null): string {
  if (!s) return "";
  let x = String(s).trim().toLowerCase();
  if (x.includes("@")) x = x.split("@").pop()!;
  x = x.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:\s]/)[0] ?? "";
  return /\.[a-z]{2,}$/.test(x) ? x : "";
}

export const isFreeMail = (domain: string): boolean => FREE_MAIL_DOMAINS.has(domain.toLowerCase());

export const normalizeEmail = (e: string): string => e.trim().toLowerCase();

/** Company name for fuzzy matching: lower case, legal suffixes and filler words dropped. */
export function normalizeCompanyName(s: string | undefined | null): string {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(inc|llc|l\.l\.c|corp|corporation|co|company|ltd|group|the|peo|services|solutions)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------- buying committee coverage ----------

const RX_FINANCE = /\b(cfo|chief financial|controller|finance|financial|accounting|accountant|treasurer)\b/i;
const RX_BUYER = /\b(ceo|chief executive|president|owner|founder|co-founder|coo|chief operating|principal|managing (partner|director|member)|general manager|partner|evp|svp|executive vice president|senior vice president|vp,? (of )?operations|vice president,? (of )?operations)\b/i;
const RX_CHAMPION = /\b(payroll|implementation|onboarding|hr operations|operations manager|director of operations|operations director|client services|service delivery|benefits|hr manager|hr director|human resources|people operations|operations)\b/i;

export type Bucket = "buyer" | "champion" | "finance";

/** A hand-set role wins; otherwise finance titles, then buyer titles, then champion titles. */
export function roleBucket(x: Pick<Contact, "role" | "title">): Bucket | null {
  if (x.role === "Signer") return "buyer";
  if (x.role === "Champion") return "champion";
  if (x.role === "Finance") return "finance";
  const t = x.title || "";
  if (RX_FINANCE.test(t)) return "finance";
  if (RX_BUYER.test(t)) return "buyer";
  if (RX_CHAMPION.test(t)) return "champion";
  return null;
}

export interface Coverage { buyer: number; champion: number; finance: number; contacts: number }

export function coverage(contacts: readonly Pick<Contact, "role" | "title">[]): Coverage {
  const r: Coverage = { buyer: 0, champion: 0, finance: 0, contacts: contacts.length };
  for (const x of contacts) { const b = roleBucket(x); if (b) r[b]++; }
  return r;
}

/** 0 to 3: one point each for having a buyer, a champion and a finance contact. */
export const coverageScore = (v: Coverage | null | undefined): number =>
  v ? (v.buyer ? 1 : 0) + (v.champion ? 1 : 0) + (v.finance ? 1 : 0) : 0;

// ---------- freshness ----------

export const isStale = (verifiedOn: IsoDate | "", today: IsoDate, staleDays = STALE_DAYS): boolean =>
  !!verifiedOn && daysBetween(verifiedOn, today) > staleDays;

/** A trigger dated `YYYY-MM` is treated as the 15th of that month. */
export function isRecentTrigger(date: string | undefined, today: IsoDate, windowDays = TRIGGER_DAYS): boolean {
  const d = String(date || "");
  if (!d) return false;
  const full = d.length === 7 ? d + "-15" : d.slice(0, 10);
  return daysBetween(full, today) <= windowDays;
}

// ---------- tiering ----------

export const isPartnerOrClient = (type: string | undefined): boolean =>
  PARTNER_TYPES.has(String(type)) || type === "Existing client" || type === "PEO broker";

/** Accounts that get a tier: not partners or clients, not marked unfit or partner, not closed, not a known duplicate. */
export function isTierEligible(c: Company, isDuplicate: boolean): boolean {
  return !isPartnerOrClient(c.type) && c.fit !== "Not a fit" && c.fit !== "Partner" && c.stage !== "Signed" && c.stage !== "Lost" && !isDuplicate;
}

/** Inputs to the tier score, resolved from the company and its research data. */
export interface TierSignals {
  /** Resolved company type (research classification wins over the CRM field for prospects). */
  type: string;
  /** Primary platform, if known. */
  platform?: string;
  size?: "Large" | "Medium" | "Small";
  hiringSignal?: "strong" | "weak" | "none";
  /** Research priority 1 to 5. */
  researchPriority?: number;
  national?: boolean;
  recentTriggers: number;
  coverage: Coverage | null;
  stage: Company["stage"];
}

export interface TierScore { score: number; parts: string[] }

export function tierScore(s: TierSignals): TierScore {
  const parts: string[] = [];
  let score = 0;
  const add = (v: number, label: string) => { if (v) { score += v; parts.push(`${label} +${v}`); } };
  add(s.type === "PEO" ? 3 : s.type === "ASO" ? 2 : s.type === "Payroll only" || s.type === "EOR" ? 1 : 0, s.type || "Type");
  add(s.platform === "PrismHR" ? 3 : s.platform ? 1 : 0, "Platform " + (s.platform || ""));
  add(s.size === "Large" ? 3 : s.size === "Medium" ? 2 : s.size === "Small" ? 1 : 0, "Size " + (s.size || ""));
  add(s.hiringSignal === "strong" ? 4 : s.hiringSignal === "weak" ? 2 : 0, "Hiring signal");
  add(Math.max(0, (s.researchPriority || 0) - 2), "Research priority P" + (s.researchPriority || 0));
  add(s.national ? 1 : 0, "National reach");
  add(Math.min(4, s.recentTriggers * 2), "Recent trigger");
  add(coverageScore(s.coverage) >= 2 ? 1 : 0, "Two or more roles mapped");
  add(isOpenStage(s.stage) ? 2 : 0, "Open deal");
  return { score, parts };
}

export type Tier = "A" | "B" | "C";
export interface Tiered { id: string; tier: Tier; score: number; parts: string[]; rank: number }

/** Rank by score (ties broken by id), then the top `tierA` are A, the next `tierB` are B, the rest C. */
export function assignTiers(rows: readonly ({ id: string } & TierScore)[], tierA: number, tierB: number): Tiered[] {
  return [...rows]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((r, i) => ({ id: r.id, score: r.score, parts: r.parts, rank: i + 1, tier: i < tierA ? "A" : i < tierA + tierB ? "B" : "C" }));
}

// ---------- Enwage ----------

export interface EnwageFlag { level: "flag" | "possible"; why: string }

/**
 * A team flag always wins. Otherwise prospects (PEO, ASO, payroll only) on a platform where Enwage
 * competes are "possible". Clients, partners and companies already on Enwage are never flagged.
 */
export function enwageFlag(c: Company, resolvedType: string, platform: string | undefined, platforms: ReadonlySet<string> = DEFAULT_ENWAGE_PLATFORMS): EnwageFlag | null {
  if (c.enwageLead) return { level: "flag", why: c.enwageWhy || "Flagged by the team" };
  if (isPartnerOrClient(c.type) || c.platform === "Enwage") return null;
  if (platform && platforms.has(platform) && ["PEO", "ASO", "Payroll only"].includes(resolvedType)) {
    return { level: "possible", why: `Runs ${platform}. Ask about cost and support before pitching Enwage.` };
  }
  return null;
}

// ---------- displayed type and platform ----------

/**
 * The type shown for a company, as the artifact computes it: partners and clients show their own type;
 * every other company shows the researched type when there is one, else its own type.
 * Note: a type set by hand is overridden by the researched type (open decision 20).
 */
export function displayType(c: { type?: string | null; classified_type?: string | null }): string {
  if (isPartnerOrClient(c.type ?? undefined)) return String(c.type);
  return c.classified_type || c.type || "";
}

/** Platform and where it came from: the CRM field first (unless "Unknown"), then the platform map, then research. */
export function resolvePlatform(crm: string | null | undefined, mapped: string | null | undefined, researched: string | null | undefined): { name: string; source: "CRM" | "Platform map" | "Research" } | null {
  if (crm && crm !== "Unknown") return { name: crm, source: "CRM" };
  if (mapped) return { name: mapped, source: "Platform map" };
  if (researched) return { name: researched, source: "Research" };
  return null;
}
