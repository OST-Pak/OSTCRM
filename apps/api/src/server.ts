import pg from "pg";
import { buildApp } from "./app.js";
import { adminRoutes } from "./routes/admin.js";
import { pipelineRoutes } from "./routes/pipeline.js";
import { prospectRoutes } from "./routes/prospects.js";
import { companyRoutes } from "./routes/company.js";
import { boardRoutes } from "./routes/board.js";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };

// Secrets come from Key Vault through the container's managed identity (Engineer A), never from files in the repo.
const pool = new pg.Pool({ connectionString: need("DATABASE_URL"), max: Number(process.env.DB_POOL_MAX ?? 10) });
export const app = buildApp({ pool, auth: { tenantId: need("ENTRA_TENANT_ID"), audience: need("ENTRA_API_AUDIENCE") } });
await app.register(adminRoutes, { prefix: "/v1" });
await app.register(pipelineRoutes, { prefix: "/v1" });
await app.register(prospectRoutes, { prefix: "/v1" });
await app.register(companyRoutes, { prefix: "/v1" });
await app.register(boardRoutes, { prefix: "/v1" });
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
