import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthConfig {
  /** Entra tenant id. Tokens from any other tenant are refused. */
  tenantId: string;
  /** The API's application id URI or client id, as it appears in the token's `aud`. */
  audience: string;
  /** Delegated scope the web app requests for this API (an ID token has none, so it is refused). */
  requiredScope?: string;
  /** Key source. Production: the tenant's JWKS endpoint (cached). Tests: a local key set. */
  keys?: JWTVerifyGetKey;
}

export interface VerifiedToken { oid: string; tid: string; name?: string; email?: string }

const keySets = new Map<string, JWTVerifyGetKey>();

/** The tenant's signing keys, fetched once and cached (jose refreshes on an unknown key id, with a cooldown). */
export function entraKeys(tenantId: string): JWTVerifyGetKey {
  let k = keySets.get(tenantId);
  if (!k) {
    k = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`), { cooldownDuration: 30_000, cacheMaxAge: 3_600_000 });
    keySets.set(tenantId, k);
  }
  return k;
}

/**
 * Verifies a Microsoft Entra ID v2 access token: signature (RS256), issuer for our tenant, audience
 * (use the App ID URI), expiry with 60 seconds of clock skew, the tenant claim, token version and the
 * delegated scope, so an ID token for the same app is refused. Identity comes only from the token,
 * never from anything the caller types (closes known issue 4).
 */
export async function verifyToken(token: string, cfg: AuthConfig): Promise<VerifiedToken> {
  const { payload } = await jwtVerify(token, cfg.keys ?? entraKeys(cfg.tenantId), {
    issuer: `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`,
    audience: cfg.audience,
    algorithms: ["RS256"],
    clockTolerance: 60,
    requiredClaims: ["oid", "tid", "exp"]
  });
  if (payload.tid !== cfg.tenantId) throw new Error("wrong tenant");
  // Only access tokens for this API: they carry delegated scopes; ID tokens do not.
  const scopes = typeof payload.scp === "string" ? payload.scp.split(" ") : [];
  if (!scopes.includes(cfg.requiredScope ?? "access_as_user")) throw new Error("missing scope");
  if (payload.ver !== "2.0") throw new Error("not a v2 token");
  return {
    oid: String(payload.oid),
    tid: String(payload.tid),
    name: typeof payload.name === "string" ? payload.name : undefined,
    email: typeof payload.preferred_username === "string" ? payload.preferred_username : undefined
  };
}
