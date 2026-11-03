/**
 * Masks an export for staging dry runs (open decision 11 default). Production data never goes to staging,
 * so Engineer B runs this on the real export and loads the masked file.
 *
 * Kept: ids, links between records, stages, dates, counts, seats, prices, types, channels, platforms, states.
 * Replaced: names, emails, phones, websites, domains, LinkedIn, free text (notes, summaries, proposal text).
 * Deterministic per secret, so the same company masks the same way in every collection and across runs.
 */
import { createHmac } from "node:crypto";
import type { ArtifactExport, ArtifactRecord } from "./types.js";

const tag = (secret: string, kind: string, v: string) => createHmac("sha256", secret).update(kind + "\u0000" + v.toLowerCase()).digest("hex").slice(0, 8);

const TEXT_KEYS = new Set(["notes", "summary", "text", "pain", "fitReason", "lostNote", "outline", "purpose", "needs", "intro", "scope", "closing", "terms", "subject", "contacts", "enwageWhy", "nextStep", "title"]);
const NAME_KEYS = new Set(["name", "companyName", "contactName", "brokerName", "firstName"]);
const KEEP_TEXT_COLLECTIONS = new Set(["config", "platforms"]);

export function maskExport(x: ArtifactExport, secret: string): ArtifactExport {
  if (secret.length < 16) throw new Error("Use a masking secret of at least 16 characters");
  const companyName = (v: string) => `Company ${tag(secret, "co", v)}`;
  const personName = (v: string) => `Person ${tag(secret, "pe", v)}`;
  const domain = (v: string) => `${tag(secret, "do", v)}.example.com`;
  const email = (v: string) => `${tag(secret, "em", v)}@${domain(v.split("@").pop() ?? "")}`;
  const text = (v: string) => `[masked ${v.length} chars]`;

  const maskValue = (coll: string, key: string, v: unknown): unknown => {
    if (typeof v !== "string" || !v) return v;
    if (key === "email" || key === "to") return email(v);
    if (key === "phone") return "+1555" + tag(secret, "ph", v).replace(/[a-f]/g, "0").slice(0, 7);
    if (key === "domain") return domain(v);
    if (key === "website" || key === "linkedin" || key === "link") return `https://${domain(v)}`;
    if (NAME_KEYS.has(key)) return ["companies", "clients", "brokers", "proposals"].includes(coll) && key !== "contactName" && key !== "firstName" ? companyName(v) : personName(v);
    if (TEXT_KEYS.has(key) && !KEEP_TEXT_COLLECTIONS.has(coll)) return text(v);
    return v;
  };
  const maskDeep = (coll: string, v: unknown, key = ""): unknown => {
    if (Array.isArray(v)) return v.map(x => maskDeep(coll, x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, maskDeep(coll, x, k)]));
    return maskValue(coll, key, v);
  };

  const collections: ArtifactExport["collections"] = {};
  for (const [coll, rows] of Object.entries(x.collections)) {
    // The audit trail holds before/after values of every field; it is not needed for dry runs.
    if (coll === "audit" || coll === "auditDays") { collections[coll] = []; continue; }
    collections[coll] = (rows ?? []).map(r => ({ ...(maskDeep(coll, r) as ArtifactRecord), id: r.id }));
  }
  return { ...x, exportedBy: "", collections, warnings: [...(x.warnings ?? []), "Masked for staging: names, contact details and free text replaced; audit trail removed"] };
}
