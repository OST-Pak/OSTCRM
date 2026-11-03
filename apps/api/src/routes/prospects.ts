import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeCompanyName, rankProspects, type ProspectInput } from "@ostcrm/domain";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Prospects: every company with its tier, score, coverage and research summary.
 * Tiers rank the whole book, so the server scores every company and then filters and pages the result.
 */
export async function prospectRoutes(app: FastifyInstance) {
  app.get("/prospects", { config: { action: "pipeline.read" } }, async req => {
    const q = z.object({
      q: z.string().trim().max(100).optional(),
      tier: z.enum(["A", "B", "C", "none"]).optional(),
      type: z.string().max(60).optional(),
      fit: z.string().max(60).optional(),
      state: z.string().max(40).optional(),
      sort: z.enum(["tier", "name", "state", "size"]).default("tier"),
      today: isoDate.optional(),
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(200).default(100)
    }).parse(req.query);
    const today = q.today ?? new Date().toISOString().slice(0, 10);
    return req.tx(async db => {
      const rows = (await db.query(
        `SELECT c.id, c.name, c.name_normalized, c.domain, c.website, c.type, c.classified_type, c.fit, c.fit_reason, c.state, c.hq_city, c.hq_state,
                c.reach, c.platform_name AS platform, c.size, c.employees, c.hiring_signal, c.hiring_jobs, c.research_priority, c.national,
                c.enwage_lead, c.duplicate_of IS NOT NULL AS duplicate, u.display_name AS owner, d.stage,
                coalesce((SELECT array_agg(t.occurred_on::text) FROM triggers t WHERE t.company_id = c.id AND t.archived_at IS NULL AND t.occurred_on IS NOT NULL), '{}') AS trigger_dates,
                coalesce((SELECT json_agg(json_build_object('role', k.role, 'title', k.title)) FROM contacts k WHERE k.company_id = c.id AND k.archived_at IS NULL), '[]') AS contacts
           FROM companies c
           LEFT JOIN users u ON u.id = c.owner_id
           LEFT JOIN LATERAL (SELECT stage FROM deals WHERE company_id = c.id AND archived_at IS NULL
                              ORDER BY (stage IN ('Signed', 'Lost', 'Nurture (Q1)')), updated_at DESC LIMIT 1) d ON true
          WHERE c.archived_at IS NULL`)).rows as (ProspectInput & Record<string, unknown>)[];
      const ranked = new Map(rankProspects(rows, today).map(r => [r.id, r]));
      const needle = q.q ? normalizeCompanyName(q.q) : "";
      const all = rows.map(r => {
        const k = ranked.get(r.id)!;
        return {
          id: r.id, name: r.name, domain: r.domain, website: r.website, type: k.type, fit: r.fit, fitReason: r.fit_reason,
          state: r.state ?? r.hq_state, city: r.hq_city, reach: r.reach, platform: r.platform, size: r.size, employees: r.employees,
          hiringSignal: r.hiring_signal, hiringJobs: r.hiring_jobs, researchPriority: r.research_priority, enwage: r.enwage_lead,
          duplicate: r.duplicate, owner: r.owner, stage: k.stage, tier: k.tier, rank: k.rank, score: k.score, why: k.why,
          coverage: k.coverage, recentTriggers: k.recentTriggers, _n: r.name_normalized as string
        };
      });
      const facets = {
        types: [...new Set(all.map(r => r.type).filter(Boolean))].sort(),
        fits: [...new Set(all.map(r => r.fit).filter(Boolean) as string[])].sort(),
        states: [...new Set(all.map(r => r.state).filter(Boolean) as string[])].sort(),
        tiers: { A: all.filter(r => r.tier === "A").length, B: all.filter(r => r.tier === "B").length, C: all.filter(r => r.tier === "C").length }
      };
      const SIZE = { Large: 0, Medium: 1, Small: 2 } as Record<string, number>;
      const hit = all.filter(r =>
        (!needle || r._n.includes(needle) || String(r.domain ?? "").includes(q.q!.toLowerCase())) &&
        (!q.tier || (q.tier === "none" ? r.tier === null : r.tier === q.tier)) &&
        (!q.type || r.type === q.type) && (!q.fit || r.fit === q.fit) && (!q.state || r.state === q.state)
      ).sort((a, b) =>
        q.sort === "name" ? a._n.localeCompare(b._n)
        : q.sort === "state" ? String(a.state ?? "~").localeCompare(String(b.state ?? "~")) || a._n.localeCompare(b._n)
        : q.sort === "size" ? (SIZE[a.size ?? ""] ?? 3) - (SIZE[b.size ?? ""] ?? 3) || a._n.localeCompare(b._n)
        : (a.rank ?? 1e9) - (b.rank ?? 1e9) || a._n.localeCompare(b._n));
      const items = hit.slice(q.offset, q.offset + q.limit).map(({ _n, ...r }) => r);
      return { total: hit.length, offset: q.offset, items, facets };
    });
  });
}
