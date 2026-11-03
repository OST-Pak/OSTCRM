import { createHash, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { ZodError } from "zod";
import { setRequestContext } from "@ostcrm/db";
import { verifyToken, type AuthConfig } from "./auth.js";
import { ApiError, badRequest, forbidden, fromPg } from "./errors.js";
import { ACTIONS, can, type Action, type Role } from "./permissions.js";

declare module "fastify" {
  interface FastifyContextConfig { action?: Action | "public" }
  interface FastifyRequest {
    user: { id: string; role: Role; name: string } | null;
    /** Runs `fn` in one transaction as this person (row-level security and audit apply). */
    tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T>;
  }
}

export interface AppOptions { pool: Pool; auth: AuthConfig; logLevel?: string }

/**
 * Builds the API. Every route must declare `config.action`: a named permission, or "public".
 * A route without one fails at startup, so no route can ship without a permission check.
 */
export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? "info",
      // Structured JSON logs with request id, user id, route and duration. No bodies, no tokens, no contact data.
      redact: ["req.headers.authorization", "req.headers.cookie"],
      serializers: { req: r => ({ method: r.method, url: r.url.split("?")[0], id: r.id }) }
    },
    genReqId: req => {
      const h = req.headers["x-request-id"];
      return typeof h === "string" && /^[\w-]{8,64}$/.test(h) ? h : randomUUID();
    },
    bodyLimit: 1_048_576
  });

  app.addHook("onRoute", route => {
    const action = route.config?.action;
    if (!action) throw new Error(`Route ${route.method} ${route.url} has no permission (config.action)`);
    if (action !== "public" && !(ACTIONS as readonly string[]).includes(action)) throw new Error(`Route ${route.method} ${route.url} has unknown action ${action}`);
  });

  app.decorateRequest("user", null);
  app.decorateRequest("tx", function (this: FastifyRequest) { throw new Error("tx used before auth"); } as never);

  const ctxOf = (req: FastifyRequest, role: Role | "system", userId: string | null) => ({
    userId, role, requestId: String(req.id), ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300)
  });

  async function inTx<T>(ctx: Parameters<typeof setRequestContext>[1], fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await opts.pool.connect();
    try {
      await db.query("BEGIN");
      await setRequestContext(db, ctx);
      const r = await fn(db);
      await db.query("COMMIT");
      return r;
    } catch (e) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      db.release();
    }
  }

  app.addHook("onRequest", async (req, reply) => {
    const action = req.routeOptions.config?.action;
    if (action === "public" || !req.routeOptions.url) return;
    const h = req.headers.authorization ?? "";
    const m = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(h);
    if (!m) throw new ApiError(401, "unauthenticated", "Sign in with Microsoft to continue");
    let oid: string;
    try { oid = (await verifyToken(m[1]!, opts.auth)).oid; } catch { throw new ApiError(401, "unauthenticated", "Your sign-in is not valid or has expired"); }
    // Look up the person and their live role. The database decides the role on every query anyway.
    const who = await opts.pool.query<{ id: string; name: string; role: Role | null; disabled: boolean }>("SELECT * FROM app.resolve_user($1)", [oid]);
    const u = who.rows[0];
    if (!u || u.disabled || !u.role) throw new ApiError(403, "no_access", "You do not have access to the CRM. Ask Saad to add you.");
    req.user = { id: u.id, role: u.role, name: u.name };
    req.tx = fn => inTx(ctxOf(req, u.role!, u.id), fn);
    if (!can(u.role, action as Action)) {
      await req.tx(db => db.query("SELECT app.log_event('denied', $1, NULL, $2)", [req.routeOptions.url, JSON.stringify({ action, method: req.method })]));
      throw forbidden(action as string);
    }
    reply.header("x-request-id", req.id);
  });

  app.setErrorHandler(async (err, req, reply) => {
    let e: ApiError | null = err instanceof ApiError ? err : fromPg(err);
    if (!e && err instanceof ZodError) e = badRequest("Some fields are not valid", err.issues.map(i => ({ path: i.path.join("."), message: i.message })));
    if (!e && (err as { validation?: unknown }).validation) e = badRequest(err.message);
    if (!e && (err as { statusCode?: number }).statusCode === 413) e = new ApiError(413, "too_large", "Request is too large");
    if (!e) {
      req.log.error({ err, route: req.routeOptions.url, userId: req.user?.id }, "unhandled error");
      // Errors are stored with the request id, not just printed (closes known issue 7).
      await inTx(ctxOf(req, req.user?.role ?? "read_only", req.user?.id ?? null), db => db.query(
        "INSERT INTO errors (source, request_id, user_id, route, message, stack) VALUES ('server', $1, $2, $3, $4, $5)",
        [String(req.id), req.user?.id ?? null, req.routeOptions.url ?? req.url, String((err as Error).message).slice(0, 2000), String((err as Error).stack ?? "").slice(0, 8000)]
      )).catch(x => req.log.error({ err: x }, "could not store error"));
      e = new ApiError(500, "server_error", "Something went wrong. The error was recorded.");
    }
    reply.status(e.status).header("x-request-id", req.id).send({ error: { code: e.code, message: e.message, details: e.details }, requestId: req.id });
  });

  app.setNotFoundHandler((req, reply) => { reply.status(404).send({ error: { code: "not_found", message: "No such route" }, requestId: req.id }); });

  return app;
}

/**
 * Runs a command at most once per Idempotency-Key. A retry with the same key and body returns the first
 * response; the same key with a different body is refused. Runs inside the caller's transaction, so the
 * key, the change and the stored response commit together.
 */
export async function idempotent(req: FastifyRequest, reply: FastifyReply, db: PoolClient, fn: () => Promise<{ status: number; body: unknown }>): Promise<unknown> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8 || key.length > 200) throw badRequest("Send an Idempotency-Key header (8 to 200 characters) with every command");
  const hash = createHash("sha256").update(`${req.method} ${req.routeOptions.url} ${JSON.stringify(req.params)} ${JSON.stringify(req.body ?? null)}`).digest("hex");
  await db.query("INSERT INTO idempotency_keys (user_id, key, route, request_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    [req.user!.id, key, `${req.method} ${req.routeOptions.url}`, hash]);
  const row = (await db.query<{ request_hash: string; response_status: number | null; response_body: unknown }>(
    "SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2 FOR UPDATE", [req.user!.id, key])).rows[0]!;
  if (row.request_hash !== hash) throw new ApiError(422, "idempotency_mismatch", "This Idempotency-Key was already used for a different request");
  if (row.response_status !== null) {
    reply.header("idempotent-replay", "true");
    reply.status(row.response_status);
    return row.response_body;
  }
  const r = await fn();
  await db.query("UPDATE idempotency_keys SET response_status = $3, response_body = $4 WHERE user_id = $1 AND key = $2", [req.user!.id, key, r.status, JSON.stringify(r.body)]);
  reply.status(r.status);
  return r.body;
}
