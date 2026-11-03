/**
 * End-to-end checks against the real API and a real PostgreSQL database (TEST_DATABASE_URL), in Chromium.
 * Starts the API with a fake Entra tenant, builds the app in e2e mode, serves it, and runs each check file
 * in e2e/checks. Screenshots for review land in e2e/out.
 *   TEST_DATABASE_URL=... pnpm --filter @ostcrm/web e2e
 */
import { spawn, execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const api = join(web, "..", "api");
const out = join(here, "out");
mkdirSync(out, { recursive: true });
const tokensFile = join(out, "tokens.json");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const procs = [];
const start = (cmd, args, cwd, env, ready) => new Promise((resolve, reject) => {
  // Own process group, so stopping it also stops the server pnpm started.
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  procs.push(p);
  const t = setTimeout(() => reject(new Error(`${cmd} did not start`)), 60_000);
  const on = d => { if (String(d).includes(ready)) { clearTimeout(t); resolve(p); } };
  p.stdout.on("data", on); p.stderr.on("data", d => { on(d); if (process.env.E2E_DEBUG) process.stderr.write(d); });
  p.on("exit", c => { clearTimeout(t); if (c) reject(new Error(`${cmd} exited ${c}`)); });
});
const stopAll = () => procs.forEach(p => { try { process.kill(-p.pid, "SIGTERM"); } catch { /* already gone */ } });
process.on("exit", stopAll);

let failures = 0;
try {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  execSync("pnpm exec vite build --mode e2e --outDir dist-e2e", { cwd: web, stdio: "ignore" });
  await start("pnpm", ["exec", "tsx", "test/e2e-server.ts"], api, { PORT: "8787", E2E_TOKENS: tokensFile }, "e2e api ready");
  await start("pnpm", ["exec", "vite", "preview", "--outDir", "dist-e2e", "--port", "4173", "--strictPort"], web, { E2E_API: "http://127.0.0.1:8787" }, "4173");
  const tokens = JSON.parse(readFileSync(tokensFile, "utf8"));
  const browser = await chromium.launch();
  const base = "http://127.0.0.1:4173";
  const page = async (role, { width = 1280, theme } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme ?? "light" });
    await ctx.addInitScript(t => { window.__E2E_TOKEN__ = t; }, tokens[role]);
    // The sandbox has no internet: answer the Google Fonts requests locally so real page errors still show.
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
    const p = await ctx.newPage();
    p.errors = [];
    p.on("pageerror", e => p.errors.push(e.message));
    p.on("console", m => { if (m.type() === "error") p.errors.push(m.text()); });
    return p;
  };
  const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
  const files = readdirSync(join(here, "checks")).filter(f => f.endsWith(".mjs")).sort();
  for (const f of files) {
    console.log(`\n# ${f}`);
    const mod = await import(join(here, "checks", f));
    await mod.default({ page, check, base, out });
  }
  await browser.close();
} catch (e) {
  console.error(e); failures++;
} finally {
  stopAll();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
