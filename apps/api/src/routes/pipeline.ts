import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LOGGABLE_ACTIVITY_TYPES, STAGES, activityEffect, normalizeCompanyName } from "@ostcrm/domain";
import { idempotent } from "../app.js";
import { ApiError, badRequest, conflict, notFound } from "../errors.js";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const stage = z.enum(STAGES as unknown as [string, ...string[]]);

// ---------- cursor paging (closes known issue 3: no silent caps) ----------
const encodeCursor = (name: string, id: string) => Buffer.from(JSON.stringify([name, id])).toString("base64url");
function decodeCursor(c: string | undefined): [string, string] | null {
  if (!c) return null;
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && uuid.safeParse(v[1]).success) return [v[0], v[1]];
  } catch { /* fall through */ }
  throw badRequest("Invalid cursor");
}

/** Read only users see contact details partly hidden in lists and exports. */
const maskEmail = (e: string | null) => (e ? e.replace(/^(.)[^@]*(@.*)$/, "$1***$2") : e);
const maskPhone = (p: string | null) => (p ? "•••• " + p.replace(/\D/g, "").slice(-4) : p);

export async function pipelineRoutes(app: FastifyInstance) {
  app.get("/companies", { config: { action: "pipeline.read" } }, async req => {
    const q = z.object({
      q: z.string().trim().max(100).optional(),
      stage: stage.optional(),
      ownerId: uuid.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: z.string().max(500).optional()
    }).parse(req.query);
    const after = decodeCursor(q.cursor);
    return req.tx(async db => {
      const rows = (await db.query(
        `SELECT c.id, c.name, c.domain, c.type, c.state, c.platform_name, c.owner_id, c.version, d.id AS deal_id, d.stage, d.next_step_on, c.name_normalized
           FROM companies c
           LEFT JOIN LATERAL (SELECT id, stage, next_step_on FROM deals WHERE company_id = c.id AND archived_at IS NULL
                              ORDER BY (stage IN ('Signed', 'Lost', 'Nurture (Q1)')), updated_at DESC LIMIT 1) d ON true
          WHERE c.archived_at IS NULL AND c.duplicate_of IS NULL
            AND ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%' ESCAPE '\\' OR c.domain ILIKE '%' || $1 || '%' ESCAPE '\\')
            AND ($2::deal_stage IS NULL OR coalesce(d.stage, 'Target') = $2::deal_stage)
            AND ($3::uuid IS NULL OR c.owner_id = $3)
            AND ($4::text IS NULL OR (c.name_normalized, c.id) > ($4, $5::uuid))
          ORDER BY c.name_normalized, c.id
          LIMIT $6`,
        [q.q ? q.q.replace(/[\\%_]/g, m => "\\" + m) : null, q.stage ?? null, q.ownerId ?? null, after?.[0] ?? null, after?.[1] ?? null, q.limit + 1])).rows;
      const more = rows.length > q.limit;
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return { items: page.map(({ name_normalized: _n, ...r }) => r), nextCursor: more && last ? encodeCursor(last.name_normalized, last.id) : null };
    });
  });

  app.get("/companies/:id", { config: { action: "pipeline.read" } }, async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const readOnly = req.user!.role === "read_only";
    return req.tx(async db => {
      const c = (await db.query("SELECT * FROM companies WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!c) throw notFound("Company");
      const contacts = (await db.query("SELECT id, name, title, role, email, phone, version FROM contacts WHERE company_id = $1 AND archived_at IS NULL ORDER BY name", [id])).rows
        .map(k => (readOnly ? { ...k, email: maskEmail(k.email), phone: maskPhone(k.phone) } : k));
      const deals = (await db.query("SELECT * FROM deals WHERE company_id = $1 AND archived_at IS NULL ORDER BY created_at", [id])).rows;
      await db.query("SELECT app.log_event('view', 'companies', $1)", [id]);
      return { ...c, phone: readOnly ? maskPhone(c.phone) : c.phone, contacts, deals };
    });
  });

  /** Edit company fields. Send the version you read; a stale version returns 409 (closes known issue 1). */
  app.patch("/companies/:id", { config: { action: "deal.edit" } }, async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      version: z.number().int().min(1),
      name: z.string().trim().min(1).max(200).optional(),
      type: z.string().max(60).nullable().optional(),
      channel: z.string().max(60).nullable().optional(),
      state: z.string().max(60).nullable().optional(),
      website: z.string().max(300).nullable().optional(),
      ownerId: uuid.nullable().optional(),
      worksiteEmployees: z.number().int().min(0).nullable().optional()
    }).strict().parse(req.body);
    const cols: Record<string, unknown> = {};
    if (b.name !== undefined) { cols.name = b.name; cols.name_normalized = normalizeCompanyName(b.name); }
    if (b.type !== undefined) cols.type = b.type;
    if (b.channel !== undefined) cols.channel = b.channel;
    if (b.state !== undefined) cols.state = b.state;
    if (b.website !== undefined) cols.website = b.website;
    if (b.ownerId !== undefined) cols.owner_id = b.ownerId;
    if (b.worksiteEmployees !== undefined) cols.worksite_employees = b.worksiteEmployees;
    if (!Object.keys(cols).length) throw badRequest("Nothing to change");
    if (req.user!.role === "specialist") throw new ApiError(403, "forbidden", "Specialists can change deals assigned to them, not company records");
    return req.tx(async db => {
      const keys = Object.keys(cols);
      const set = keys.map((k, i) => `"${k}" = $${i + 3}`).join(", ");
      const r = await db.query(`UPDATE companies SET ${set} WHERE id = $1 AND version = $2 AND archived_at IS NULL RETURNING *`, [id, b.version, ...Object.values(cols)]);
      if (r.rowCount === 1) return r.rows[0];
      const current = (await db.query("SELECT * FROM companies WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!current) throw notFound("Company");
      throw conflict(current);
    });
  });

  /** Move a deal's stage: updates the deal, records a stage event and an outbox event, all in one transaction. */
  app.post("/deals/:id/stage", { config: { action: "deal.edit" } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ version: z.number().int().min(1), stage, onDate: isoDate.optional() }).strict().parse(req.body);
    return req.tx(db => idempotent(req, reply, db, async () => {
      const prev = (await db.query("SELECT stage, version, owner_id FROM deals WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!prev) throw notFound("Deal");
      // Row scope: a Specialist works only deals assigned to them. The database enforces this too.
      if (req.user!.role === "specialist" && prev.owner_id !== req.user!.id) throw new ApiError(403, "forbidden", "Specialists can change only deals assigned to them");
      if (prev.version !== b.version) throw conflict(prev);
      if (prev.stage === b.stage) throw badRequest(`The deal is already at ${b.stage}`);
      const on = b.onDate ?? new Date().toISOString().slice(0, 10);
      const r = await db.query(
        `UPDATE deals SET stage = $3::deal_stage, stage_changed_on = $4::date, cadence_stage = NULL, cadence_done = '{}',
                signed_on = CASE WHEN $3::deal_stage = 'Signed' THEN coalesce(signed_on, $4::date) ELSE signed_on END
          WHERE id = $1 AND version = $2 RETURNING *`, [id, b.version, b.stage, on]);
      if (r.rowCount !== 1) throw conflict(prev);
      await db.query("INSERT INTO deal_stage_events (deal_id, from_stage, to_stage, changed_on) VALUES ($1, $2, $3, $4)", [id, prev.stage, b.stage, on]);
      await db.query("INSERT INTO outbox (topic, payload) VALUES ('deal.stage_changed', $1)", [JSON.stringify({ dealId: id, from: prev.stage, to: b.stage, on, by: req.user!.id })]);
      return { status: 200, body: r.rows[0] };
    }));
  });

  /**
   * Log an activity. Activities are append-only; corrections are new rows that reference the original.
   * When the company has a deal, logging also applies the artifact's effects in the same transaction:
   * auto-advance the stage, record the first proposal date, and carry the next step (domain `activityEffect`).
   * An open deal needs a next step and a date that is not in the past.
   */
  app.post("/activities", { config: { action: "activity.log" } }, async (req, reply) => {
    const b = z.object({
      companyId: uuid.nullable(),
      dealId: uuid.nullable().optional(),
      contactId: uuid.nullable().optional(),
      type: z.enum(LOGGABLE_ACTIVITY_TYPES),
      direction: z.enum(["Inbound", "Outbound"]).nullable().optional(),
      outcome: z.enum(["Positive", "Neutral", "Negative", "No answer"]).nullable().optional(),
      objection: z.string().max(100).nullable().optional(),
      touchCount: z.number().int().min(0).max(10_000).default(1),
      occurredOn: isoDate,
      summary: z.string().max(5000).nullable().optional(),
      nextStep: z.string().trim().max(500).nullable().optional(),
      nextStepOn: isoDate.nullable().optional(),
      today: isoDate.optional(),
      correctsId: uuid.nullable().optional()
    }).strict().parse(req.body);
    const today = b.today ?? new Date().toISOString().slice(0, 10);
    return req.tx(db => idempotent(req, reply, db, async () => {
      // The deal this activity is about: the one named, else the company's current deal.
      let deal = b.dealId
        ? (await db.query("SELECT id, stage, version, owner_id, proposal_sent_on::text FROM deals WHERE id = $1 AND archived_at IS NULL", [b.dealId])).rows[0]
        : b.companyId
          ? (await db.query(`SELECT id, stage, version, owner_id, proposal_sent_on::text FROM deals WHERE company_id = $1 AND archived_at IS NULL
                              ORDER BY (stage IN ('Signed', 'Lost', 'Nurture (Q1)')), updated_at DESC LIMIT 1`, [b.companyId])).rows[0]
          : undefined;
      if (b.dealId && !deal) throw notFound("Deal");
      // A company with no deal row is a deal at Target, as in the artifact: an activity that moves it creates the deal.
      if (!deal && b.companyId && req.user!.role !== "specialist") {
        const co = (await db.query("SELECT owner_id FROM companies WHERE id = $1 AND archived_at IS NULL AND duplicate_of IS NULL", [b.companyId])).rows[0];
        if (co) deal = { id: null, stage: "Target", version: null, owner_id: co.owner_id, proposal_sent_on: null };
      }
      // A Specialist works only deals assigned to them: on anyone else's, the activity is kept on the company and the deal is left alone.
      if (deal && req.user!.role === "specialist" && deal.owner_id !== req.user!.id) {
        if (b.dealId) throw new ApiError(403, "forbidden", "Specialists can log against only deals assigned to them");
        deal = undefined;
      }
      const effect = activityEffect(deal ? { stage: deal.stage, proposalSentOn: deal.proposal_sent_on } : null,
        { type: b.type, direction: b.direction ?? null, outcome: b.outcome ?? null, occurredOn: b.occurredOn, nextStep: b.nextStep ?? null, nextStepOn: b.nextStepOn ?? null }, today);
      if (effect.error) throw badRequest(effect.error);
      const moves = !!(effect.stage || effect.proposalSentOn || effect.nextStep !== undefined);
      if (deal && !deal.id) {
        deal = moves
          ? { ...(await db.query("INSERT INTO deals (company_id, stage, owner_id, stage_changed_on) VALUES ($1, 'Target', $2, $3) RETURNING id, stage, version, owner_id", [b.companyId, deal.owner_id, today])).rows[0], proposal_sent_on: null }
          : undefined;
      }
      const r = await db.query(
        `INSERT INTO activities (company_id, deal_id, contact_id, type, direction, outcome, objection, touch_count, occurred_on, summary, source, corrects_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'CRM', $11) RETURNING *`,
        [b.companyId, deal?.id ?? null, b.contactId ?? null, b.type, b.direction ?? null, b.outcome ?? null, b.objection ?? null, b.touchCount, b.occurredOn, b.summary ?? null, b.correctsId ?? null]);
      let updated: unknown = null;
      if (deal && moves) {
        const u = await db.query(
          `UPDATE deals SET stage = coalesce($2::deal_stage, stage),
                  stage_changed_on = CASE WHEN $2::deal_stage IS NOT NULL THEN $5::date ELSE stage_changed_on END,
                  cadence_stage = CASE WHEN $2::deal_stage IS NOT NULL THEN NULL ELSE cadence_stage END,
                  cadence_done = CASE WHEN $2::deal_stage IS NOT NULL THEN '{}' ELSE cadence_done END,
                  proposal_sent_on = coalesce(proposal_sent_on, $3::date),
                  next_step = CASE WHEN $4::boolean THEN $6::text ELSE next_step END,
                  next_step_on = CASE WHEN $4::boolean THEN $7::date ELSE next_step_on END
            WHERE id = $1 RETURNING *`,
          [deal.id, effect.stage ?? null, effect.proposalSentOn ?? null, effect.nextStep !== undefined, today, effect.nextStep ?? null, effect.nextStepOn ?? null]);
        updated = u.rows[0];
        if (effect.stage) {
          await db.query("INSERT INTO deal_stage_events (deal_id, from_stage, to_stage, changed_on) VALUES ($1, $2, $3, $4)", [deal.id, deal.stage, effect.stage, today]);
          await db.query("INSERT INTO outbox (topic, payload) VALUES ('deal.stage_changed', $1)", [JSON.stringify({ dealId: deal.id, from: deal.stage, to: effect.stage, on: today, by: req.user!.id })]);
        }
      }
      return { status: 201, body: { ...r.rows[0], deal: updated } };
    }));
  });

  /**
   * Archive a company. Its open deals, open tasks and outreach steps are archived in the same transaction;
   * activities stay for history (closes known issue 5). Nothing is hard-deleted.
   */
  app.post("/companies/:id/archive", { config: { action: "deal.archive" } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ version: z.number().int().min(1), confirm: z.literal(true) }).strict().parse(req.body);
    return req.tx(db => idempotent(req, reply, db, async () => {
      const r = await db.query("UPDATE companies SET archived_at = now() WHERE id = $1 AND version = $2 AND archived_at IS NULL RETURNING id, name", [id, b.version]);
      if (r.rowCount !== 1) {
        const current = (await db.query("SELECT id, version, archived_at FROM companies WHERE id = $1", [id])).rows[0];
        if (!current || current.archived_at) throw notFound("Company");
        throw conflict(current);
      }
      const deals = await db.query("UPDATE deals SET archived_at = now() WHERE company_id = $1 AND archived_at IS NULL AND stage NOT IN ('Signed', 'Lost') RETURNING id", [id]);
      const tasks = await db.query("UPDATE tasks SET archived_at = now() WHERE company_id = $1 AND archived_at IS NULL AND done_at IS NULL", [id]);
      const steps = await db.query("UPDATE outreach_steps SET archived_at = now() WHERE company_id = $1 AND archived_at IS NULL", [id]);
      return { status: 200, body: { archived: r.rows[0], deals: deals.rowCount, tasks: tasks.rowCount, outreachSteps: steps.rowCount } };
    }));
  });
}
