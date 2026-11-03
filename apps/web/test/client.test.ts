import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApi, messageFor } from "../src/api/client.js";

const auth = { getToken: async () => "token-1", signOut: async () => undefined };
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("sends the token and a request id, and parses JSON", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, { ok: true }));
    await expect(createApi(auth).get("/v1/me")).resolves.toEqual({ ok: true });
    const h = (f.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer token-1");
    expect(h["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(h["idempotency-key"]).toBeUndefined();
  });

  it("commands carry an idempotency key, and a retry can reuse it", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply(201, { id: "a1" }));
    const api = createApi(auth);
    await api.command("POST", "/v1/activities", { type: "Call" }, "key-12345678");
    await api.command("POST", "/v1/activities", { type: "Call" }, "key-12345678");
    const keys = f.mock.calls.map(c => ((c[1] as RequestInit).headers as Record<string, string>)["idempotency-key"]);
    expect(keys).toEqual(["key-12345678", "key-12345678"]);
    await api.command("POST", "/v1/activities", {});
    expect(((f.mock.calls[2]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("turns API errors into ApiError with the code and request id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(409, { error: { code: "conflict", message: "Changed by someone else" }, requestId: "r-1" }));
    const e = await createApi(auth).get("/v1/x").catch(x => x) as ApiError;
    expect([e.status, e.code, e.requestId, e.isConflict]).toEqual([409, "conflict", "r-1", true]);
  });

  it("a network failure is status 0", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    expect((await createApi(auth).get("/v1/x").catch(x => x) as ApiError).status).toBe(0);
  });

  it("reports errors to the server without recursing when reporting fails", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(500, { error: { code: "server_error", message: "x" } }));
    const api = createApi(auth);
    api.reportError("boom"); api.reportError("again");
    await new Promise(r => setTimeout(r, 0));
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((f.mock.calls[0]![1] as RequestInit).body)).message).toBe("boom");
  });
});

describe("plain messages", () => {
  it("names what failed and what to do next", () => {
    expect(messageFor(new ApiError(0, "network", ""), "save the stage change")).toBe("Couldn't save the stage change: no connection. Your changes are still here. Try again.");
    expect(messageFor(new ApiError(409, "conflict", ""), "save")).toContain("someone else changed this record");
    expect(messageFor(new ApiError(403, "forbidden", ""), "save")).toContain("your role can't do this");
    expect(messageFor(new ApiError(400, "bad_request", "Open deals need a next step and a date."), "save")).toBe("Couldn't save: Open deals need a next step and a date.");
    expect(messageFor(new ApiError(500, "server_error", "", undefined, "req-9"), "save")).toContain("reference req-9");
    expect(messageFor(new Error("x"), "save")).toBe("Couldn't save. Try again.");
  });
});
