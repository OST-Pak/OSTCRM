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
const KEEP_TEXT_COLLECTIONS = new Set(["platforms"]);

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
    if (key === "website" || key === "linkedin" || key === "link" || key === "url") return `https://${domain(v)}`;
    // A source can be a link (trigger sources) or a label (Apollo, Web); only links are masked.
    if (key === "source" && /^https?:\/\//i.test(v)) return `https://${domain(v)}`;
    if (NAME_KEYS.has(key)) return ["companies", "clients", "brokers", "proposals"].includes(coll) && key !== "contactName" && key !== "firstName" ? companyName(v) : personName(v);
    if (TEXT_KEYS.has(key) && !KEEP_TEXT_COLLECTIONS.has(coll)) return text(v);
    return v;
  };
  const maskDeep = (coll: string, v: unknown, key = ""): unknown => {
    if (Array.isArray(v)) return v.map(x => maskDeep(coll, x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, maskDeep(coll, x, k)]));
    return maskValue(coll, key, v);
  };

  /** Research and scan records under config/ hold company names and notes inside maps; mask them by meaning. */
  const mapValues = <T,>(m: unknown, f: (v: T) => unknown) => Object.fromEntries(Object.entries((m ?? {}) as Record<string, T>).map(([k, v]) => [k, f(v)]));
  const s2 = (v: unknown) => (typeof v === "string" && v ? v : "");
  const maskConfig = (r: ArtifactRecord): ArtifactRecord => {
    switch (r.id) {
      case "proposalTemplate": case "roles": case "forecast": case "research": case "size": case "founded": case "platform": case "coverage":
        return r; // codes, numbers, platform names and the template; no prospect names or free text
      case "class":
        return { ...r, map: mapValues<Record<string, unknown>>(r.map, v => ({ ...v, p: v.p ? companyName(s2(v.p)) : v.p, rel: v.rel ? text(s2(v.rel)) : v.rel, rb: v.rb ? text(s2(v.rb)) : v.rb })) };
      case "groups":
        return { ...r, map: mapValues<Record<string, unknown>>(r.map, v => ({ ...v, n: companyName(s2(v.n)), note: v.note ? text(s2(v.note)) : v.note })) };
      case "fit":
        return { ...r, map: mapValues<Record<string, unknown>>(r.map, v => ({ ...v, reason: v.reason ? text(s2(v.reason)) : v.reason })) };
      case "dupes":
        return { ...r, map: mapValues<Record<string, unknown>>(r.map, v => ({ ...v, note: v.note ? text(s2(v.note)) : v.note })) };
      case "triggers":
        return { ...r, map: mapValues<Record<string, unknown>[]>(r.map, list => (list ?? []).map(t => maskDeep("triggers", t))) };
      case "featured":
        return { ...r, note: "", items: ((r.items ?? []) as Record<string, unknown>[]).map(i => ({ ...i, name: companyName(s2(i.name)),
          jobs: ((i.jobs ?? []) as Record<string, unknown>[]).map(j => ({ ...j, url: j.url ? `https://${domain(s2(j.url))}` : j.url, location: "" })) })) };
      case "watch":
        return { ...r, note: "", orgs: ((r.orgs ?? []) as Record<string, unknown>[]).map(o => ({ ...o, n: companyName(s2(o.n)) })) };
      case "team":
        return { ...r, note: "", emails: mapValues<string>(r.emails, e => email(e)) };
      default:
        // Unknown settings: keep only the id, so nothing unreviewed reaches staging.
        return { id: r.id };
    }
  };

  const collections: ArtifactExport["collections"] = {};
  for (const [coll, rows] of Object.entries(x.collections)) {
    // The audit trail holds before/after values of every field; it is not needed for dry runs.
    if (coll === "audit" || coll === "auditDays") { collections[coll] = []; continue; }
    if (coll === "config") { collections[coll] = (rows ?? []).map(maskConfig); continue; }
    // Per-company research (web summaries, decision makers, news): keep the scores, replace the rest.
    if (coll === "research") {
      collections[coll] = (rows ?? []).map(r => ({ id: r.id, priority: r.priority, hiringSignal: r.hiringSignal, bestOffer: r.bestOffer, web: { summary: "[masked]" } }));
      continue;
    }
    collections[coll] = (rows ?? []).map(r => ({ ...(maskDeep(coll, r) as ArtifactRecord), id: r.id }));
  }
  return { ...x, exportedBy: "", collections, warnings: [...(x.warnings ?? []), "Masked for staging: names, contact details and free text replaced; audit trail removed"] };
}
