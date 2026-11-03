import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_CADENCE, PIPELINE_STAGES, cadenceFor, cadenceTick, documentDue, documentsDue, lastTouchByCompany, pipelineBoard, signatureDueAfter } from "@ostcrm/domain";
import { idempotent } from "../app.js";
import { ApiError, badRequest, conflict, notFound } from "../errors.js";
import { toDomainDeal } from "../shape.js";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const todayOf = (t?: string) => t ?? new Date().toISOString().slice(0, 10);

/** Each company's current deal (open first), with the company name and owner. */
const CURRENT_DEALS = `
  SELECT DISTINCT ON (d.company_id) d.*, c.name, u.display_name AS owner_name
    FROM deals d JOIN companies c ON c.id = d.company_id AND c.archived_at IS NULL AND c.duplicate_of IS NULL
    LEFT JOIN users u ON u.id = d.owner_id
   WHERE d.archived_at IS NULL
   ORDER BY d.company_id, (d.stage IN ('Signed', 'Lost', 'Nurture (Q1)')), d.updated_at DESC`;

async function dealForCompany(db: import("pg").PoolClient, dealId: string) {
  const r = (await db.query("SELECT d.*, c.name FROM deals d JOIN companies c ON c.id = d.company_id WHERE d.id = $1 AND d.archived_at IS NULL", [dealId])).rows[0];
  if (!r) throw notFound("Deal");
  return r;
}

export async function boardRoutes(app: FastifyInstance) {
  /** The pipeline board, documents due and the cadence reference, computed with the domain rules. */
  app.get("/pipeline", { config: { action: "pipeline.read" } }, async req => {
    const q = z.object({ ownerId: uuid.optional(), today: isoDate.optional() }).parse(req.query);
    const today = todayOf(q.today);
    return req.tx(async db => {
      const rows = (await db.query(CURRENT_DEALS)).rows;
      const deals = rows.map(toDomainDeal);
      const onBoard = deals.filter(d => (PIPELINE_STAGES as readonly string[]).includes(d.stage) && (!q.ownerId || d.ownerId === q.ownerId));
      const ids = onBoard.map(d => d.id);
      const acts = ids.length ? (await db.query(
        "SELECT company_id, type, max(occurred_on)::text AS date FROM activities WHERE company_id = ANY($1::uuid[]) GROUP BY company_id, type", [ids])).rows : [];
      const lastTouch = lastTouchByCompany(acts.map(a => ({ companyId: a.company_id, type: a.type, date: a.date })));
      const board = pipelineBoard(onBoard, lastTouch, today);
      const owners = [...new Map(deals.filter(d => d.ownerId).map(d => [d.ownerId!, d.ownerName ?? ""])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
      return { ...board, documents: documentsDue(onBoard, today), owners, cadence: PIPELINE_STAGES.map(stage => ({ stage, steps: DEFAULT_CADENCE[stage] ?? [] })) };
    });
  });

  /** The drawer's cadence panel for one deal: steps for its stage, and what document is due. */
  app.get("/deals/:id/cadence", { config: { action: "pipeline.read" } }, async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { today } = z.object({ today: isoDate.optional() }).parse(req.query);
    return req.tx(async db => {
      const d = toDomainDeal(await dealForCompany(db, id));
      const t = todayOf(today);
      return { plan: cadenceFor(d, t), document: documentDue(d, t), contractSentOn: d.contractSentDate ?? null };
    });
  });

  /** Tick a cadence step off; logs the matching activity in the same transaction. */
  app.post("/deals/:id/cadence", { config: { action: "deal.edit" } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ version: z.number().int().min(1), index: z.number().int().min(0).max(50), today: isoDate.optional() }).strict().parse(req.body);
    const today = todayOf(b.today);
    return req.tx(db => idempotent(req, reply, db, async () => {
      const row = await dealForCompany(db, id);
      if (req.user!.role === "specialist" && row.owner_id !== req.user!.id) throw new ApiError(403, "forbidden", "Specialists can change only deals assigned to them");
      if (row.version !== b.version) throw conflict({ version: row.version });
      const t = cadenceTick(toDomainDeal(row), b.index, today);
      if (t.error) throw badRequest(t.error);
      const u = await db.query("UPDATE deals SET cadence_stage = stage, cadence_done = $3::smallint[] WHERE id = $1 AND version = $2 RETURNING *", [id, b.version, t.done]);
      if (u.rowCount !== 1) throw conflict({ version: null });
      await db.query("INSERT INTO activities (company_id, deal_id, type, direction, occurred_on, summary, source) VALUES ($1, $2, $3, 'Outbound', $4, $5, 'Cadence')",
        [row.company_id, id, t.activity!.type, today, t.activity!.summary]);
      return { status: 200, body: u.rows[0] };
    }));
  });

  /** Mark the contract sent at Verbal yes: signature falls due 3 days later; logs a note. */
  app.post("/deals/:id/contract-sent", { config: { action: "deal.edit" } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ version: z.number().int().min(1), today: isoDate.optional() }).strict().parse(req.body);
    const today = todayOf(b.today);
    return req.tx(db => idempotent(req, reply, db, async () => {
      const row = await dealForCompany(db, id);
      if (req.user!.role === "specialist" && row.owner_id !== req.user!.id) throw new ApiError(403, "forbidden", "Specialists can change only deals assigned to them");
      if (row.stage !== "Verbal yes") throw badRequest("Contracts are sent at Verbal yes.");
      if (row.contract_sent_on) throw badRequest("The contract is already marked sent.");
      const u = await db.query("UPDATE deals SET contract_sent_on = $3, signature_due_on = $4 WHERE id = $1 AND version = $2 RETURNING *", [id, b.version, today, signatureDueAfter(today)]);
      if (u.rowCount !== 1) throw conflict({ version: row.version });
      await db.query("INSERT INTO activities (company_id, deal_id, type, direction, occurred_on, summary, source) VALUES ($1, $2, 'Note', 'Outbound', $3, 'Contract sent', 'CRM')", [row.company_id, id, today]);
      return { status: 200, body: u.rows[0] };
    }));
  });
}
