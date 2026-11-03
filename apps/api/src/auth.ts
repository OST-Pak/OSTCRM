import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthConfig {
  /** Entra tenant id. Tokens from any other tenant are refused. */
  tenantId: string;
  /** The API's application id URI or client id, as it appears in the token's `aud`. */
  audience: string;
  /** Key source. Production: the tenant's JWKS endpoint. Tests: a local key set. */
  keys?: JWTVerifyGetKey;
}

export interface VerifiedToken { oid: string; tid: string; name?: string; email?: string }

export function entraKeys(tenantId: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
}

/**
 * Verifies a Microsoft Entra ID v2 access token: signature (RS256), issuer for our tenant, audience,
 * expiry with 60 seconds of clock skew, and the tenant claim. Identity comes only from the token,
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
  return {
    oid: String(payload.oid),
    tid: String(payload.tid),
    name: typeof payload.name === "string" ? payload.name : undefined,
    email: typeof payload.preferred_username === "string" ? payload.preferred_username : undefined
  };
}
