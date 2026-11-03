import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: true, target: "es2022" },
  // The API is served under /v1 on the same origin in production (Front Door); locally Vite proxies to it.
  server: { port: 5173, proxy: { "/v1": process.env.E2E_API ?? "http://localhost:8080", "/local": "http://localhost:8080" } },
  preview: { proxy: { "/v1": process.env.E2E_API ?? "http://localhost:8080" } },
  test: { environment: "jsdom", include: ["test/**/*.test.tsx", "test/**/*.test.ts"] }
});
