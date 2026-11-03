import { describe, expect, it } from "vitest";
import {
  assignTiers, coverage, coverageScore, domainOf, enwageFlag, isFreeMail, isRecentTrigger, isStale, isTierEligible,
  normalizeCompanyName, normalizeEmail, roleBucket, tierScore, type Company, type TierSignals
} from "../src/index.js";

const co = (x: Partial<Company>): Company => ({ id: "c1", name: "Acme PEO", stage: "Target", ...x });

describe("normalization", () => {
  it("extracts a bare domain from URLs and emails", () => {
    expect(domainOf("https://www.AcmePEO.com/about?x=1")).toBe("acmepeo.com");
    expect(domainOf("jane@acmepeo.com")).toBe("acmepeo.com");
    expect(domainOf("acmepeo.com:443")).toBe("acmepeo.com");
    expect(domainOf("not a domain")).toBe("");
    expect(domainOf("")).toBe("");
    expect(domainOf(undefined)).toBe("");
  });

  it("flags free mail and lower-cases email", () => {
    expect(isFreeMail("Gmail.com")).toBe(true);
    expect(isFreeMail("acmepeo.com")).toBe(false);
    expect(normalizeEmail("  Jane@AcmePEO.com ")).toBe("jane@acmepeo.com");
  });

  it("normalizes company names for fuzzy matching", () => {
    expect(normalizeCompanyName("The Acme PEO Group, LLC")).toBe("acme");
    expect(normalizeCompanyName("Smith & Jones HR Solutions Inc.")).toBe("smith and jones hr");
    expect(normalizeCompanyName(null)).toBe("");
  });
});

describe("coverage", () => {
  it("a hand-set role wins over the title", () => {
    expect(roleBucket({ role: "Signer", title: "Payroll Specialist" })).toBe("buyer");
    expect(roleBucket({ role: "Champion" })).toBe("champion");
    expect(roleBucket({ role: "Finance" })).toBe("finance");
  });

  it("finance beats buyer beats champion when a title matches more than one", () => {
    expect(roleBucket({ title: "CFO" })).toBe("finance");
    expect(roleBucket({ title: "President and CFO" })).toBe("finance");
    expect(roleBucket({ title: "VP of Operations" })).toBe("buyer");
    expect(roleBucket({ title: "Director of Payroll" })).toBe("champion");
    expect(roleBucket({ title: "Receptionist" })).toBeNull();
    expect(roleBucket({})).toBeNull();
  });

  it("scores one point per role present", () => {
    const v = coverage([{ title: "CEO" }, { title: "Payroll Manager" }, { title: "Sales" }]);
    expect(v).toEqual({ buyer: 1, champion: 1, finance: 0, contacts: 3 });
    expect(coverageScore(v)).toBe(2);
    expect(coverageScore(null)).toBe(0);
  });
});

describe("freshness", () => {
  it("is stale after 90 days", () => {
    expect(isStale("2026-08-12", "2026-11-10")).toBe(false);
    expect(isStale("2026-08-11", "2026-11-10")).toBe(true);
    expect(isStale("", "2026-11-10")).toBe(false);
  });

  it("triggers count for 120 days; month-only dates count from the 15th", () => {
    expect(isRecentTrigger("2026-07-13", "2026-11-10")).toBe(true);
    expect(isRecentTrigger("2026-07-12", "2026-11-10")).toBe(false);
    expect(isRecentTrigger("2026-07", "2026-11-10")).toBe(true);
    expect(isRecentTrigger("", "2026-11-10")).toBe(false);
  });
});

describe("tiers", () => {
  it("eligibility excludes partners, clients, unfit, closed and duplicates", () => {
    expect(isTierEligible(co({ type: "PEO" }), false)).toBe(true);
    expect(isTierEligible(co({ type: "PEO broker" }), false)).toBe(false);
    expect(isTierEligible(co({ type: "CPA firm" }), false)).toBe(false);
    expect(isTierEligible(co({ type: "Existing client" }), false)).toBe(false);
    expect(isTierEligible(co({ type: "PEO", fit: "Not a fit" }), false)).toBe(false);
    expect(isTierEligible(co({ type: "PEO", fit: "Partner" }), false)).toBe(false);
    expect(isTierEligible(co({ type: "PEO", stage: "Signed" }), false)).toBe(false);
    expect(isTierEligible(co({ type: "PEO", stage: "Lost" }), false)).toBe(false);
    expect(isTierEligible(co({ type: "PEO" }), true)).toBe(false);
  });

  const max: TierSignals = { type: "PEO", platform: "PrismHR", size: "Large", hiringSignal: "strong", researchPriority: 5, national: true, recentTriggers: 3, coverage: { buyer: 1, champion: 1, finance: 0, contacts: 2 }, stage: "Proposal sent" };

  it("scores every signal, capping recent triggers at 4", () => {
    const s = tierScore(max);
    expect(s.score).toBe(3 + 3 + 3 + 4 + 3 + 1 + 4 + 1 + 2);
    expect(s.parts).toContain("Recent trigger +4");
  });

  it("scores lesser signals", () => {
    expect(tierScore({ type: "ASO", platform: "isolved", size: "Medium", hiringSignal: "weak", researchPriority: 3, recentTriggers: 1, coverage: null, stage: "Target" }).score).toBe(2 + 1 + 2 + 2 + 1 + 2);
    expect(tierScore({ type: "Payroll only", size: "Small", recentTriggers: 0, coverage: null, stage: "Target" }).score).toBe(1 + 1);
    expect(tierScore({ type: "EOR", recentTriggers: 0, coverage: null, stage: "Target" }).score).toBe(1);
    expect(tierScore({ type: "", recentTriggers: 0, coverage: null, stage: "Target" })).toEqual({ score: 0, parts: [] });
  });

  it("assigns A, B and C by rank with ties broken by id", () => {
    const t = assignTiers([
      { id: "b", score: 10, parts: [] }, { id: "a", score: 10, parts: [] }, { id: "c", score: 5, parts: [] }, { id: "d", score: 1, parts: [] }
    ], 1, 2);
    expect(t.map(x => `${x.id}${x.tier}${x.rank}`)).toEqual(["aA1", "bB2", "cB3", "dC4"]);
  });
});

describe("Enwage flag", () => {
  it("a team flag always wins", () => {
    expect(enwageFlag(co({ enwageLead: true }), "PEO", undefined)).toEqual({ level: "flag", why: "Flagged by the team" });
    expect(enwageFlag(co({ enwageLead: true, enwageWhy: "Asked about payroll software" }), "PEO", undefined)?.why).toBe("Asked about payroll software");
  });

  it("prospects on a competing platform are possible", () => {
    expect(enwageFlag(co({}), "PEO", "isolved")?.level).toBe("possible");
    expect(enwageFlag(co({}), "Payroll only", "Worklio")?.level).toBe("possible");
  });

  it("never flags PrismHR shops, other types, clients, partners or Enwage users", () => {
    expect(enwageFlag(co({}), "PEO", "PrismHR")).toBeNull();
    expect(enwageFlag(co({}), "Staffing agency", "isolved")).toBeNull();
    expect(enwageFlag(co({ type: "Existing client" }), "PEO", "isolved")).toBeNull();
    expect(enwageFlag(co({ type: "PEO broker" }), "PEO", "isolved")).toBeNull();
    expect(enwageFlag(co({ platform: "Enwage" }), "PEO", "isolved")).toBeNull();
  });
});

describe("displayed type and platform", () => {
  it("partners and clients keep their own type", async () => {
    const { displayType } = await import("../src/index.js");
    expect(displayType({ type: "PEO broker", classified_type: "PEO" })).toBe("PEO broker");
    expect(displayType({ type: "Existing client", classified_type: "PEO" })).toBe("Existing client");
  });

  it("other companies show the researched type, else their own, else nothing", async () => {
    const { displayType } = await import("../src/index.js");
    expect(displayType({ type: "Other", classified_type: "ASO" })).toBe("ASO");
    expect(displayType({ type: "PEO", classified_type: null })).toBe("PEO");
    expect(displayType({})).toBe("");
  });

  it("platform comes from the CRM, then the platform map, then research", async () => {
    const { resolvePlatform } = await import("../src/index.js");
    expect(resolvePlatform("PrismHR", "isolved", "Worklio")).toEqual({ name: "PrismHR", source: "CRM" });
    expect(resolvePlatform("Unknown", "isolved", "Worklio")).toEqual({ name: "isolved", source: "Platform map" });
    expect(resolvePlatform("", null, "Worklio")).toEqual({ name: "Worklio", source: "Research" });
    expect(resolvePlatform(null, null, null)).toBeNull();
  });
});
