import type { Auth } from "../auth/token.js";

/** An error the API returned on purpose (see apps/api/src/errors.ts), or a network failure (status 0). */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public requestId?: string) { super(message); }
  get isConflict() { return this.status === 409 && this.code === "conflict"; }
}

export interface Api {
  get<T>(path: string): Promise<T>;
  /** A command: sends an Idempotency-Key so a retry of the same action never runs twice. Pass the same key to retry. */
  command<T>(method: "POST" | "PATCH", path: string, body: unknown, key?: string): Promise<T>;
  reportError(message: string, extra?: { stack?: string; route?: string; requestId?: string; context?: Record<string, unknown> }): void;
}

const newRequestId = () => crypto.randomUUID();

export function createApi(auth: Auth, base = ""): Api {
  async function call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const requestId = newRequestId();
    let res: Response;
    try {
      const headers: Record<string, string> = { authorization: `Bearer ${await auth.getToken()}`, "x-request-id": requestId };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
      res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new ApiError(0, "network", "Can't reach the CRM. Check your connection and try again.", undefined, requestId);
    }
    const rid = res.headers.get("x-request-id") ?? requestId;
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
    if (!res.ok) {
      const e = json?.error;
      throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `Request failed (${res.status})`, e?.details, json?.requestId ?? rid);
    }
    return json as T;
  }

  let reporting = false;
  return {
    get: path => call("GET", path),
    command: (method, path, body, key) => call(method, path, body, key ?? crypto.randomUUID()),
    reportError(message, extra = {}) {
      // Errors go to the server's error log, not only the browser console (known issue 7). Never recurse.
      if (reporting) return;
      reporting = true;
      call("POST", "/v1/errors", { message: message.slice(0, 2000), stack: extra.stack?.slice(0, 8000), route: extra.route ?? location.pathname, requestId: extra.requestId, context: extra.context })
        .catch(() => undefined)
        .finally(() => { reporting = false; });
    }
  };
}

/** Plain message for a failed action, naming what to do next. */
export function messageFor(e: unknown, what: string): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return `Couldn't ${what}: no connection. Your changes are still here. Try again.`;
    if (e.isConflict) return `Couldn't ${what}: someone else changed this record. Reload it to see their changes.`;
    if (e.status === 403) return `Couldn't ${what}: your role can't do this.`;
    if (e.status === 400 || e.status === 422) return `Couldn't ${what}: ${e.message}`;
    return `Couldn't ${what}. The error was recorded (reference ${e.requestId ?? "unknown"}). Try again.`;
  }
  return `Couldn't ${what}. Try again.`;
}
