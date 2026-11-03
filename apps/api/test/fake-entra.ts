/** A fake Entra tenant for tests and the local preview. Its key is made at startup; no real deployment trusts it. */
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from "jose";

export const TENANT = "11111111-1111-4111-8111-111111111111";
export const AUDIENCE = "api://ostcrm-test";

/** A fake Entra tenant: a signing key, its key set, and a token minter. */
export async function fakeEntra() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const other = await generateKeyPair("RS256");
  const token = (oid: string, o: { tid?: string; aud?: string; iss?: string; exp?: string; wrongKey?: boolean; idToken?: boolean } = {}) =>
    new SignJWT({ oid, tid: o.tid ?? TENANT, name: "Test", preferred_username: `${oid}@example.com`, ver: "2.0", ...(o.idToken ? {} : { scp: "access_as_user" }) })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(o.iss ?? `https://login.microsoftonline.com/${o.tid ?? TENANT}/v2.0`)
      .setAudience(o.aud ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(o.exp ?? "1h")
      .sign(o.wrongKey ? other.privateKey : privateKey);
  return { keys, token };
}
