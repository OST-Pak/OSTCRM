import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idempotent } from "../app.js";
import { ApiError, badRequest, notFound } from "../errors.js";

const uuid = z.string().uuid();
const csv = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };

export async function adminRoutes(app: FastifyInstance) {
  app.get("/health", { config: { action: "public" } }, async () => ({ ok: true }));

  app.get("/me", { config: { action: "pipeline.read" } }, async req => req.user);

  /** Change someone's role. Owner only, a reason is required, and the change is audited. */
  app.post("/users/:id/role", { config: { action: "role.change" } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ role: z.enum(["owner", "admin", "bd_support", "specialist", "read_only"]), reason: z.string().trim().min(3).max(500) }).strict().parse(req.body);
    if (id === req.user!.id) throw badRequest("You cannot change your own role");
    return req.tx(db => idempotent(req, reply, db, async () => {
      const u = (await db.query("SELECT id FROM users WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!u) throw notFound("Person");
      await db.query("SELECT set_config('app.reason', $1, true)", [b.reason]);
      await db.query("UPDATE role_assignments SET archived_at = now() WHERE user_id = $1 AND archived_at IS NULL", [id]);
      const r = await db.query("INSERT INTO role_assignments (user_id, role, reason) VALUES ($1, $2, $3) RETURNING user_id, role, reason, created_at", [id, b.role, b.reason]);
      await db.query("INSERT INTO outbox (topic, payload) VALUES ('alert.role_changed', $1)", [JSON.stringify({ userId: id, role: b.role, by: req.user!.id })]);
      return { status: 200, body: r.rows[0] };
    }));
  });

  /**
   * Bulk export of the pipeline. A separate permission, logged, and it alerts the owner:
   * this is the main data-theft path in any CRM.
   */
  app.get("/exports/companies.csv", { config: { action: "export.csv" } }, async (req, reply) => {
    const rows = await req.tx(async db => {
      const r = await db.query(`SELECT c.name, c.domain, c.type, c.state, c.platform_name, u.display_name AS owner, d.stage, d.next_step_on
                                  FROM companies c LEFT JOIN users u ON u.id = c.owner_id
                                  LEFT JOIN deals d ON d.company_id = c.id AND d.archived_at IS NULL
                                 WHERE c.archived_at IS NULL ORDER BY c.name_normalized, c.id`);
      await db.query("SELECT app.log_event('export', 'companies', NULL, $1)", [JSON.stringify({ rows: r.rowCount, format: "csv" })]);
      await db.query("INSERT INTO outbox (topic, payload) VALUES ('alert.bulk_export', $1)", [JSON.stringify({ by: req.user!.id, rows: r.rowCount, what: "companies" })]);
      return r.rows;
    });
    const head = ["name", "domain", "type", "state", "platform", "owner", "stage", "next_step_on"];
    const body = [head.join(","), ...rows.map(r => [r.name, r.domain, r.type, r.state, r.platform_name, r.owner, r.stage, r.next_step_on instanceof Date ? r.next_step_on.toISOString().slice(0, 10) : r.next_step_on].map(csv).join(","))].join("\r\n");
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="companies-${new Date().toISOString().slice(0, 10)}.csv"`);
    return body;
  });

  /** The audit log, newest first, paged. Owner and admin only. */
  app.get("/audit", { config: { action: "audit.read" } }, async req => {
    const q = z.object({ entity: z.string().max(60).optional(), entityId: z.string().max(100).optional(), before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return req.tx(async db => {
      const r = await db.query(
        `SELECT a.*, u.display_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE ($1::text IS NULL OR a.entity = $1) AND ($2::text IS NULL OR a.entity_id = $2) AND ($3::bigint IS NULL OR a.id < $3)
          ORDER BY a.id DESC LIMIT $4`, [q.entity ?? null, q.entityId ?? null, q.before ?? null, q.limit]);
      return { items: r.rows, nextBefore: r.rows.length === q.limit ? r.rows[r.rows.length - 1].id : null };
    });
  });

  /** The web app reports its own errors here, with the request id, so they are not lost in a browser console. */
  app.post("/errors", { config: { action: "error.report" } }, async (req, reply) => {
    const b = z.object({ message: z.string().min(1).max(2000), stack: z.string().max(8000).optional(), route: z.string().max(300).optional(),
      requestId: z.string().max(64).optional(), context: z.record(z.unknown()).optional() }).strict().parse(req.body);
    if (JSON.stringify(b.context ?? {}).length > 4000) throw new ApiError(413, "too_large", "Error context is too large");
    await req.tx(db => db.query("INSERT INTO errors (source, request_id, user_id, route, message, stack, context) VALUES ('client', $1, $2, $3, $4, $5, $6)",
      [b.requestId ?? String(req.id), req.user!.id, b.route ?? null, b.message, b.stack ?? null, JSON.stringify(b.context ?? {})]));
    reply.status(204);
  });
}
