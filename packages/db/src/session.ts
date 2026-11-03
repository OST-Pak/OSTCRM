import type { ClientBase } from "pg";

export type Role = "owner" | "admin" | "bd_support" | "specialist" | "read_only" | "system";

export interface RequestContext {
  userId: string | null;
  role: Role;
  requestId: string;
  actorType?: "person" | "agent" | "system";
  agentName?: string;
  ip?: string;
  userAgent?: string;
  reason?: string;
}

/**
 * Stamps the transaction with who is acting, for row-level security and the audit trigger.
 * Must be called inside a transaction: the settings are transaction-local and vanish at COMMIT,
 * so a pooled connection never carries one person's identity into another's request.
 */
export async function setRequestContext(db: ClientBase, ctx: RequestContext): Promise<void> {
  await db.query(
    `SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true),
            set_config('app.request_id', $3, true), set_config('app.actor_type', $4, true),
            set_config('app.agent_name', $5, true), set_config('app.ip', $6, true),
            set_config('app.user_agent', $7, true), set_config('app.reason', $8, true)`,
    [ctx.userId ?? "", ctx.role, ctx.requestId, ctx.actorType ?? (ctx.userId ? "person" : "system"),
      ctx.agentName ?? "", ctx.ip ?? "", ctx.userAgent ?? "", ctx.reason ?? ""]
  );
}

/** Runs `fn` in one transaction as the given person. Rolls back on any error. */
export async function withContext<T>(db: ClientBase, ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  await db.query("BEGIN");
  try {
    await setRequestContext(db, ctx);
    const r = await fn();
    await db.query("COMMIT");
    return r;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}
