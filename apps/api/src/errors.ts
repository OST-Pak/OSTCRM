/** Errors the API returns on purpose, with a stable code the web app can branch on. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export const notFound = (what = "Record") => new ApiError(404, "not_found", `${what} not found`);
export const forbidden = (action: string) => new ApiError(403, "forbidden", `Your role cannot do this (${action})`);
export const conflict = (current: unknown) => new ApiError(409, "conflict", "Changed by someone else. Reload to see the latest version.", { current });
export const badRequest = (message: string, details?: unknown) => new ApiError(400, "bad_request", message, details);

/** Postgres error codes that mean "the request was refused", mapped to HTTP. */
export function fromPg(e: unknown): ApiError | null {
  const code = (e as { code?: string }).code;
  if (code === "42501") return new ApiError(403, "forbidden", "Not allowed");
  if (code === "23505") return new ApiError(409, "duplicate", "A record with the same key already exists", { constraint: (e as { constraint?: string }).constraint });
  if (code === "23503") return badRequest("A linked record does not exist");
  if (code === "23514" || code === "22P02" || code === "22007") return badRequest("A value is not valid");
  return null;
}
