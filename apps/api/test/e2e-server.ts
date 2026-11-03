/**
 * Runs the real API on a throwaway database with a fake Entra tenant, seeded with synthetic data,
 * for the web app's end-to-end checks. Writes one access token per role to the file named by E2E_TOKENS.
 * Test use only: it signs tokens with a key it generates, which no real deployment trusts.
 */
import { writeFileSync } from "node:fs";
import { testApp } from "./setup.js";
import { seedDemo } from "./seed-demo.js";

const T = await testApp();
await seedDemo(T.db.owner, T.people);
const tokens: Record<string, string> = {};
for (const r of ["owner", "admin", "bd_support", "specialist", "read_only"] as const) tokens[r] = await T.entra.token(T.people[r].oid, { exp: "4h" });
writeFileSync(process.env.E2E_TOKENS ?? "e2e-tokens.json", JSON.stringify(tokens));
await T.app.listen({ port: Number(process.env.PORT ?? 8080), host: "127.0.0.1" });
console.log("e2e api ready");
const stop = async () => { await T.close(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
