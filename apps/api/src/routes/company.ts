import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  CHANNELS, COMPANY_TYPES, COMPETING_OPTIONS, CONTACT_ROLES, FITS, LOST_REASONS, OFFERS, PILOT_STATUSES, STAGES,
  dealHealth, domainOf, isStale, lastTouchByCompany, monthlyValueCents, normalizeCompanyName, normalizeEmail, roleBucket,
  stageDatesOnSave, validateDealSave, type Stage
} from "@ostcrm/domain";
import { idempotent } from "../app.js";
import { ApiError, badRequest, conflict, notFound } from "../errors.js";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (n: number) => z.string().trim().max(n);
const opt = <T extends readonly [string, ...string[]]>(v: T) => z.union([z.enum(v), z.literal("")]).nullable().optional();
const todayOf = (t?: string) => t ?? new Date().toISOString().slice(0, 10);
const dateText = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d as string | null));

/** Qualification notes kept in companies.extra under the artifact's own names (see docs/decisions.md). */
const NOTE_KEYS = ["currentProvider", "prismModules", "competingOption", "pilotStatus", "lostNote", "pain", "notes"] as const;

const maskEmail = (e: string | null) => (e ? e.replace(/^(.)[^@]*(@.*)$/, "$1***$2") : e);
const maskPhone = (p: string | null) => (p ? "•••• " + p.replace(/\D/g, "").slice(-4) : p);

/** The company's current deal: an open one first, then the most recently changed. */
const CURRENT_DEAL = `SELECT * FROM deals WHERE company_id = $1 AND archived_at IS NULL
                       ORDER BY (stage IN ('Signed', 'Lost', 'Nurture (Q1)')), updated_at DESC LIMIT 1`;

/** The drawer's form, as one save: company fields and deal fields together, like the artifact's Save button. */
const saveBody = z.object({
  companyVersion: z.number().int().min(1),
  dealVersion: z.number().int().min(1).nullable(),
  today: isoDate.optional(),
  name: text(200).min(1),
  type: opt(COMPANY_TYPES),
  channel: opt(CHANNELS),
  platform: text(60).nullable().optional(),
  worksiteEmployees: z.number().int().min(0).nullable().optional(),
  state: text(40).nullable().optional(),
  website: text(300).nullable().optional(),
  fit: opt(FITS),
  fitReason: text(500).nullable().optional(),
  enwageLead: z.boolean().optional(),
  enwageWhy: text(500).nullable().optional(),
  ownerId: uuid.nullable().optional(),
  offer: z.union([z.enum(OFFERS as unknown as [string, ...string[]]), z.literal("")]).nullable().optional(),
  stage: z.enum(STAGES as unknown as [Stage, ...Stage[]]),
  staffSeats: z.number().int().min(0).max(10_000).default(0),
  managerSeats: z.number().int().min(0).max(10_000).default(0),
  proposalValueCents: z.number().int().min(0).nullable().optional(),
  nextStep: text(500).nullable().optional(),
  nextStepOn: isoDate.nullable().optional(),
  decisionOn: isoDate.nullable().optional(),
  targetStartOn: isoDate.nullable().optional(),
  proposalSentOn: isoDate.nullable().optional(),
  lostReason: opt(LOST_REASONS),
  decisionMakerId: uuid.nullable().optional(),
  economicBuyerId: uuid.nullable().optional(),
  currentProvider: text(300).nullable().optional(),
  prismModules: text(300).nullable().optional(),
  competingOption: opt(COMPETING_OPTIONS),
  pilotStatus: opt(PILOT_STATUSES),
  lostNote: text(1000).nullable().optional(),
  pain: text(5000).nullable().optional(),
  notes: text(10_000).nullable().optional()
}).strict();
type SaveBody = z.infer<typeof saveBody>;
const blank = (v: unknown) => (v === "" || v === undefined ? null : v);

function companyCols(b: SaveBody, prevExtra: Record<string, unknown>) {
  const extra = { ...prevExtra };
  for (const k of NOTE_KEYS) { const v = blank(b[k]); if (v === null) delete extra[k]; else extra[k] = v; }
  return {
    name: b.name, name_normalized: normalizeCompanyName(b.name), type: blank(b.type), channel: blank(b.channel), platform_name: blank(b.platform),
    worksite_employees: b.worksiteEmployees ?? null, state: blank(b.state), website: blank(b.website), domain: b.website ? domainOf(b.website) || null : null,
    fit: blank(b.fit), fit_reason: blank(b.fitReason), enwage_lead: b.enwageLead ?? false, enwage_why: blank(b.enwageWhy), owner_id: b.ownerId ?? null,
    extra: JSON.stringify(extra)
  };
}

function dealCols(b: SaveBody) {
  return {
    offer: blank(b.offer), stage: b.stage, owner_id: b.ownerId ?? null, staff_seats: b.staffSeats, manager_seats: b.managerSeats,
    expected_monthly_cents: b.proposalValueCents ?? null, next_step: blank(b.nextStep), next_step_on: b.nextStepOn ?? null,
    decision_on: b.decisionOn ?? null, target_start_on: b.targetStartOn ?? null, proposal_sent_on: b.proposalSentOn ?? null,
    lost_reason: blank(b.lostReason), decision_maker_id: b.decisionMakerId ?? null, economic_buyer_id: b.economicBuyerId ?? null
  };
}

const COMPANY_CHANGE_KEYS = ["name", "type", "channel", "platform_name", "worksite_employees", "state", "website", "fit", "fit_reason", "enwage_lead", "enwage_why", "owner_id"] as const;

async function detail(db: PoolClient, id: string, readOnly: boolean, today: string) {
  const c = (await db.query(
    `SELECT c.*, u.display_name AS owner_name, g.name AS group_name, g.note AS group_note, g.lines_of_business AS group_lines
       FROM companies c LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN company_groups g ON g.id = c.group_id
      WHERE c.id = $1 AND c.archived_at IS NULL`, [id])).rows[0];
  if (!c) throw notFound("Company");
  const deal = (await db.query(CURRENT_DEAL, [id])).rows[0] ?? null;
  const contacts = (await db.query(
    "SELECT id, name, title, role, email, phone, linkedin, email_status, verified_on, version FROM contacts WHERE company_id = $1 AND archived_at IS NULL ORDER BY name", [id])).rows
    .map(k => {
      const verified = dateText(k.verified_on);
      return { ...k, verified_on: verified, bucket: roleBucket(k), stale: verified ? isStale(verified, today) : false,
        email: readOnly ? maskEmail(k.email) : k.email, phone: readOnly ? maskPhone(k.phone) : k.phone };
    });
  const activities = (await db.query(
    `SELECT a.id, a.type, a.direction, a.outcome, a.objection, a.touch_count, a.occurred_on::text, a.summary, a.created_at, u.display_name AS by_name
       FROM activities a LEFT JOIN users u ON u.id = a.created_by WHERE a.company_id = $1
     UNION ALL
     SELECT e.id, 'Stage change', NULL, NULL, NULL, 0, e.changed_on::text, coalesce(e.from_stage::text || ' → ', '') || e.to_stage::text, e.created_at, u.display_name
       FROM deal_stage_events e JOIN deals d ON d.id = e.deal_id LEFT JOIN users u ON u.id = e.created_by WHERE d.company_id = $1
     ORDER BY occurred_on DESC, created_at DESC LIMIT 200`, [id])).rows;
  const tasks = (await db.query(
    `SELECT t.id, t.title, t.due_on::text, t.done_at, t.assignee_id, u.display_name AS assignee_name, t.version
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.company_id = $1 AND t.archived_at IS NULL
      ORDER BY (t.done_at IS NOT NULL), t.due_on NULLS LAST`, [id])).rows;
  const triggers = (await db.query("SELECT id, type, text, source_url, occurred_on::text FROM triggers WHERE company_id = $1 AND archived_at IS NULL ORDER BY occurred_on DESC NULLS LAST", [id])).rows;
  const family = c.group_id ? (await db.query(
    "SELECT id, name, type, classified_type, reach, hq_city, hq_state, related_note FROM companies WHERE group_id = $1 AND id <> $2 AND archived_at IS NULL ORDER BY name", [c.group_id, id])).rows : [];
  const duplicates = (await db.query("SELECT id, name, domain FROM companies WHERE duplicate_of = $1 AND archived_at IS NULL ORDER BY name", [id])).rows;
  const duplicateOf = c.duplicate_of ? (await db.query("SELECT id, name FROM companies WHERE id = $1", [c.duplicate_of])).rows[0] ?? null : null;

  const lastTouch = lastTouchByCompany(activities.filter(a => a.type !== "Stage change").map(a => ({ companyId: id, type: a.type, date: a.occurred_on }))).get(id);
  const health = deal ? dealHealth({
    id, name: c.name, stage: deal.stage, nextStep: deal.next_step ?? undefined, nextStepDate: dateText(deal.next_step_on) ?? undefined,
    stageChangedAt: dateText(deal.stage_changed_on) ?? undefined, decisionDate: dateText(deal.decision_on) ?? undefined
  }, lastTouch, today) : { level: "good", reasons: [] };
  const valueCents = deal ? monthlyValueCents({ staffSeats: deal.staff_seats, managerSeats: deal.manager_seats }) : 0;
  await db.query("SELECT app.log_event('view', 'companies', $1)", [id]);

  const extra = (c.extra ?? {}) as Record<string, unknown>;
  const dealOut = deal && {
    id: deal.id, version: deal.version, stage: deal.stage, offer: deal.offer, ownerId: deal.owner_id, staffSeats: deal.staff_seats, managerSeats: deal.manager_seats,
    proposalValueCents: deal.expected_monthly_cents === null ? null : Number(deal.expected_monthly_cents), nextStep: deal.next_step, nextStepOn: dateText(deal.next_step_on),
    decisionOn: dateText(deal.decision_on), targetStartOn: dateText(deal.target_start_on), proposalSentOn: dateText(deal.proposal_sent_on),
    stageChangedOn: dateText(deal.stage_changed_on), signedOn: dateText(deal.signed_on), lostReason: deal.lost_reason,
    decisionMakerId: deal.decision_maker_id, economicBuyerId: deal.economic_buyer_id
  };
  return {
    company: {
      id: c.id, version: c.version, name: c.name, type: c.type, classifiedType: c.classified_type, channel: c.channel, fit: c.fit, fitReason: c.fit_reason,
      platform: c.platform_name, platformSource: c.platform_source, worksiteEmployees: c.worksite_employees, state: c.state, website: c.website, domain: c.domain,
      phone: readOnly ? maskPhone(c.phone) : c.phone, ownerId: c.owner_id, ownerName: c.owner_name, enwageLead: c.enwage_lead, enwageWhy: c.enwage_why,
      notes: Object.fromEntries(NOTE_KEYS.map(k => [k, (extra[k] as string | undefined) ?? null])),
      research: {
        hqCity: c.hq_city, hqState: c.hq_state, reach: c.reach, reachBasis: c.reach_basis, lines: c.lines_of_business, parentName: c.parent_name,
        relatedNote: c.related_note, founded: c.founded_year, size: c.size, employees: c.employees,
        annualRevenueCents: c.annual_revenue_cents === null ? null : Number(c.annual_revenue_cents), sizeSource: c.size_source,
        hiringSignal: c.hiring_signal, hiringCategories: c.hiring_categories, hiringJobs: c.hiring_jobs, researchPriority: c.research_priority,
        bestOffer: c.best_offer, source: c.research_source, checkedOn: dateText(c.research_checked_on)
      },
      group: c.group_id ? { name: c.group_name, note: c.group_note, lines: c.group_lines, members: family } : null,
      duplicateOf, duplicates
    },
    deal: dealOut, valueCents, health, contacts, activities, tasks, triggers
  };
}

export async function companyRoutes(app: FastifyInstance) {
  /** People who can own deals and tasks. Roles stay private (owner and admin see them; see 0005_rls). */
  app.get("/users", { config: { action: "pipeline.read" } }, async req => req.tx(async db =>
    (await db.query(`SELECT u.id, u.display_name AS name FROM users u
                     WHERE u.archived_at IS NULL AND u.disabled_at IS NULL ORDER BY u.display_name`)).rows));

  /** Everything the company drawer shows, in one read. */
  app.get("/companies/:id/detail", { config: { action: "pipeline.read" } }, async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { today } = z.object({ today: isoDate.optional() }).parse(req.query);
    return req.tx(db => detail(db, id, req.user!.role === "read_only", todayOf(today)));
  });

  /** Add a prospect: the company and its deal, together. */
  app.post("/companies", { config: { action: "deal.edit" } }, async (req, reply) => {
    const b = saveBody.omit({ companyVersion: true, dealVersion: true }).extend({ companyVersion: z.undefined(), dealVersion: z.undefined() }).parse(req.body);
    if (req.user!.role === "specialist") throw new ApiError(403, "forbidden", "Specialists can't add prospects");
    const problem = validateDealSave({ name: b.name, stage: b.stage, nextStep: b.nextStep ?? undefined, nextStepDate: b.nextStepOn ?? undefined,
      staffSeats: b.staffSeats, managerSeats: b.managerSeats, proposalValueCents: b.proposalValueCents, lostReason: b.lostReason });
    if (problem) throw badRequest(problem);
    const today = todayOf(b.today);
    return req.tx(db => idempotent(req, reply, db, async () => {
      const full = { ...b, companyVersion: 1, dealVersion: null } as SaveBody;
      const cc = companyCols(full, {});
      const keys = Object.keys(cc);
      const c = (await db.query(`INSERT INTO companies (${keys.map(k => `"${k}"`).join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, Object.values(cc))).rows[0];
      const dc = { ...dealCols(full), company_id: c.id, stage_changed_on: today, signed_on: b.stage === "Signed" ? today : null };
      const dk = Object.keys(dc);
      await db.query(`INSERT INTO deals (${dk.map(k => `"${k}"`).join(", ")}) VALUES (${dk.map((k, i) => `$${i + 1}${k === "stage" ? "::deal_stage" : ""}`).join(", ")})`, Object.values(dc));
      return { status: 201, body: await detail(db, c.id, false, today) };
    }));
  });

  /** Save the drawer form. Stale versions return 409. Validation is the domain's `validateDealSave`. */
  app.put("/companies/:id/deal", { config: { action: "deal.edit" } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = saveBody.parse(req.body);
    const problem = validateDealSave({ name: b.name, stage: b.stage, nextStep: b.nextStep ?? undefined, nextStepDate: b.nextStepOn ?? undefined,
      staffSeats: b.staffSeats, managerSeats: b.managerSeats, proposalValueCents: b.proposalValueCents, lostReason: b.lostReason });
    if (problem) throw badRequest(problem);
    const today = todayOf(b.today);
    return req.tx(db => idempotent(req, reply, db, async () => {
      const prev = (await db.query("SELECT * FROM companies WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!prev) throw notFound("Company");
      if (prev.version !== b.companyVersion) throw conflict({ version: prev.version });
      const deal = (await db.query(CURRENT_DEAL, [id])).rows[0];
      if ((deal?.version ?? null) !== b.dealVersion) throw conflict({ dealVersion: deal?.version ?? null });

      const cc = companyCols(b, prev.extra ?? {});
      const companyChanged = COMPANY_CHANGE_KEYS.some(k => String(prev[k] ?? "") !== String((cc as Record<string, unknown>)[k] ?? ""))
        || JSON.stringify(prev.extra ?? {}) !== cc.extra;
      if (req.user!.role === "specialist") {
        if (!deal || deal.owner_id !== req.user!.id) throw new ApiError(403, "forbidden", "Specialists can change only deals assigned to them");
        if (companyChanged) throw new ApiError(403, "forbidden", "Specialists can change deal fields, not company fields");
        if ((b.ownerId ?? null) !== deal.owner_id) throw new ApiError(403, "forbidden", "Specialists can't reassign a deal");
      }
      if (companyChanged) {
        const keys = Object.keys(cc);
        const u = await db.query(`UPDATE companies SET ${keys.map((k, i) => `"${k}" = $${i + 3}`).join(", ")} WHERE id = $1 AND version = $2`, [id, b.companyVersion, ...Object.values(cc)]);
        if (u.rowCount !== 1) throw conflict({ version: null });
      }
      const dc: Record<string, unknown> = dealCols(b);
      if (!deal) {
        Object.assign(dc, { company_id: id, stage_changed_on: today, signed_on: b.stage === "Signed" ? today : null });
        const dk = Object.keys(dc);
        const created = (await db.query(`INSERT INTO deals (${dk.map(k => `"${k}"`).join(", ")}) VALUES (${dk.map((k, i) => `$${i + 1}${k === "stage" ? "::deal_stage" : ""}`).join(", ")}) RETURNING id`, Object.values(dc))).rows[0];
        if (b.stage !== "Target") await db.query("INSERT INTO deal_stage_events (deal_id, from_stage, to_stage, changed_on) VALUES ($1, NULL, $2, $3)", [created.id, b.stage, today]);
      } else {
        const moved = stageDatesOnSave({ stage: deal.stage, signedOn: dateText(deal.signed_on) }, b.stage, today);
        if (moved.stageChangedOn) { dc.stage_changed_on = moved.stageChangedOn; dc.cadence_stage = null; dc.cadence_done = "{}"; }
        if (moved.signedOn !== undefined) dc.signed_on = moved.signedOn;
        const dk = Object.keys(dc);
        const u = await db.query(`UPDATE deals SET ${dk.map((k, i) => `"${k}" = $${i + 3}${k === "stage" ? "::deal_stage" : ""}`).join(", ")} WHERE id = $1 AND version = $2`, [deal.id, deal.version, ...Object.values(dc)]);
        if (u.rowCount !== 1) throw conflict({ dealVersion: null });
        if (moved.stageChangedOn) {
          await db.query("INSERT INTO deal_stage_events (deal_id, from_stage, to_stage, changed_on) VALUES ($1, $2, $3, $4)", [deal.id, deal.stage, b.stage, today]);
          await db.query("INSERT INTO outbox (topic, payload) VALUES ('deal.stage_changed', $1)", [JSON.stringify({ dealId: deal.id, from: deal.stage, to: b.stage, on: today, by: req.user!.id })]);
        }
      }
      return { status: 200, body: await detail(db, id, false, today) };
    }));
  });

  // ---------- contacts ----------
  const contactBody = z.object({
    companyId: uuid, name: text(200).min(1), title: text(200).nullable().optional(), email: z.string().trim().email().max(320).nullable().optional().or(z.literal("")),
    phone: text(60).nullable().optional(), role: opt(CONTACT_ROLES)
  }).strict();
  const noSpecialist = (role: string) => { if (role === "specialist") throw new ApiError(403, "forbidden", "Specialists can't change contacts"); };

  app.post("/contacts", { config: { action: "deal.edit" } }, async (req, reply) => {
    const b = contactBody.parse(req.body);
    noSpecialist(req.user!.role);
    return req.tx(db => idempotent(req, reply, db, async () => {
      const email = b.email ? normalizeEmail(b.email) : null;
      if (email && (await db.query("SELECT 1 FROM contacts WHERE email = $1 AND archived_at IS NULL", [email])).rowCount) throw badRequest("A contact with this email is already in the CRM");
      const r = await db.query("INSERT INTO contacts (company_id, name, title, email, phone, role, source) VALUES ($1, $2, $3, $4, $5, $6, 'Manual') RETURNING *",
        [b.companyId, b.name, blank(b.title), email, blank(b.phone), blank(b.role)]);
      return { status: 201, body: r.rows[0] };
    }));
  });

  app.post("/contacts/:id/checked", { config: { action: "deal.edit" } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ version: z.number().int().min(1), today: isoDate.optional() }).strict().parse(req.body);
    noSpecialist(req.user!.role);
    return req.tx(db => idempotent(req, reply, db, async () => {
      const r = await db.query("UPDATE contacts SET verified_on = $3 WHERE id = $1 AND version = $2 AND archived_at IS NULL RETURNING *", [id, b.version, todayOf(b.today)]);
      if (r.rowCount === 1) return { status: 200, body: r.rows[0] };
      const cur = (await db.query("SELECT id, version FROM contacts WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!cur) throw notFound("Contact");
      throw conflict(cur);
    }));
  });

  app.post("/contacts/:id/archive", { config: { action: "deal.edit" } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ version: z.number().int().min(1) }).strict().parse(req.body);
    noSpecialist(req.user!.role);
    return req.tx(db => idempotent(req, reply, db, async () => {
      const r = await db.query("UPDATE contacts SET archived_at = now() WHERE id = $1 AND version = $2 AND archived_at IS NULL RETURNING id", [id, b.version]);
      if (r.rowCount === 1) {
        await db.query("UPDATE deals SET decision_maker_id = NULL WHERE decision_maker_id = $1", [id]);
        await db.query("UPDATE deals SET economic_buyer_id = NULL WHERE economic_buyer_id = $1", [id]);
        return { status: 200, body: { archived: id } };
      }
      const cur = (await db.query("SELECT id, version FROM contacts WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!cur) throw notFound("Contact");
      throw conflict(cur);
    }));
  });

  // ---------- tasks ----------
  app.post("/tasks", { config: { action: "task.manage" } }, async (req, reply) => {
    const b = z.object({ title: text(300).min(1), assigneeId: uuid.nullable().optional(), dueOn: isoDate, companyId: uuid.nullable().optional(), notes: text(2000).nullable().optional() }).strict().parse(req.body);
    return req.tx(db => idempotent(req, reply, db, async () => {
      const r = await db.query("INSERT INTO tasks (title, assignee_id, due_on, company_id, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [b.title, b.assigneeId ?? req.user!.id, b.dueOn, b.companyId ?? null, blank(b.notes)]);
      return { status: 201, body: r.rows[0] };
    }));
  });

  app.post("/tasks/:id/done", { config: { action: "task.manage" } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ version: z.number().int().min(1), done: z.boolean() }).strict().parse(req.body);
    return req.tx(db => idempotent(req, reply, db, async () => {
      const r = await db.query("UPDATE tasks SET done_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1 AND version = $2 AND archived_at IS NULL RETURNING *", [id, b.version, b.done]);
      if (r.rowCount === 1) return { status: 200, body: r.rows[0] };
      const cur = (await db.query("SELECT id, version FROM tasks WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!cur) throw notFound("Task");
      throw conflict(cur);
    }));
  });
}
