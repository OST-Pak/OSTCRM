/**
 * Maps the artifact export to the new tables. Pure: no database, no clock, no network.
 * Every record keeps its artifact id in legacy_id. Anything not mapped to a column is kept in `extra`,
 * so no field is lost. Nothing is silently dropped: each skipped record is listed in the report with a reason.
 */
import { domainOf, normalizeCompanyName, normalizeEmail, touchCount, weekStart, STAGES, type Stage } from "@ostcrm/domain";
import type { ArtifactExport, ArtifactRecord, Note, PersonMapping, Rejection, ReconciliationReport, Row, Transformed } from "./types.js";
import { uuidV7 } from "./uuid.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string => (v == null ? "" : String(v)).trim();
const orNull = (v: unknown): string | null => str(v) || null;
const dateOrNull = (v: unknown): string | null => { const s = str(v).slice(0, 10); return ISO_DATE.test(s) ? s : null; };
const tsOrNull = (v: unknown): string | null => { const s = str(v); return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null; };
const intOrNull = (v: unknown): number | null => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };
const dollarsToCents = (v: unknown): number | null => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100); };
const isUrl = (s: string) => /^https?:\/\//i.test(s);

/** Keys of `r` not in `used`, as an object for the `extra` column. Derived and housekeeping fields are dropped. */
const DROP = new Set(["id", "byUid", "loggedBy", "cov", "typeSet", "updatedAt", "updatedBy", "createdAt", "createdBy"]);
function extraOf(r: ArtifactRecord, used: readonly string[]): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) if (!used.includes(k) && !DROP.has(k) && v !== "" && v !== null && v !== undefined) out[k] = v;
  return out;
}

const ARTIFACT_ROLE: Record<string, PersonMapping["role"]> = { "BD support": "bd_support", "Specialist": "specialist", "Read only": "read_only" };

export interface TransformOptions {
  people: PersonMapping[];
  /** Team name of the owner. Defaults to "Saad". */
  ownerTeamName?: string;
}

export function transformExport(x: ArtifactExport, opts: TransformOptions): Transformed {
  if (x.format !== "oak-street-crm-export" || x.formatVersion !== 1) throw new Error("Not an Oak Street CRM export (formatVersion 1)");
  const C = (name: string): ArtifactRecord[] => x.collections[name] ?? [];
  const rejected: Rejection[] = [];
  const adjusted: Note[] = [];
  const notMigrated: ReconciliationReport["notMigrated"] = [];
  const reject = (collection: string, id: string, reason: string) => rejected.push({ collection, id, reason });
  const adjust = (collection: string, id: string, note: string) => adjusted.push({ collection, id, note });

  // ---------- people ----------
  const ownerName = opts.ownerTeamName ?? "Saad";
  const membersByUid = new Map(C("members").map(m => [m.id, str(m.member)]));
  const uidByTeam = new Map<string, string>();
  for (const [uid, team] of membersByUid) if (team) uidByTeam.set(team, uid);
  const accessByUid = new Map(C("access").map(a => [a.id, str(a.role)]));
  const users: Row[] = [];
  const userByTeam = new Map<string, string>();
  const roleRows: Row[] = [];
  const seenEmail = new Set<string>();
  for (const p of opts.people) {
    const email = normalizeEmail(p.email);
    if (!p.teamName || !email || seenEmail.has(email)) throw new Error(`People mapping: each person needs a unique email and a team name (${p.teamName || p.email})`);
    seenEmail.add(email);
    const id = uuidV7();
    const uid = uidByTeam.get(p.teamName) ?? null;
    users.push({ id, email, display_name: p.displayName, entra_oid: p.entraOid ?? null, legacy_uid: uid, legacy_team_name: p.teamName });
    userByTeam.set(p.teamName, id);
    const role = p.teamName === ownerName ? "owner" : p.role ?? (uid ? ARTIFACT_ROLE[accessByUid.get(uid) ?? ""] : undefined) ?? "read_only";
    roleRows.push({ id: uuidV7(), user_id: id, role, reason: p.role ? "Set in migration mapping" : "Carried over from the artifact" });
  }
  if (!userByTeam.has(ownerName)) throw new Error(`People mapping has no entry for the owner (${ownerName})`);
  const userIdOfUid = (uid: unknown): string | null => { const t = membersByUid.get(str(uid)); return (t && userByTeam.get(t)) || null; };
  const userIdOfName = (name: unknown): string | null => userByTeam.get(str(name)) ?? null;
  /** Author of a record: artifact uid first, then the team name it stored. */
  const authorOf = (r: ArtifactRecord): string | null => userIdOfUid(r.byUid) ?? userIdOfName(r.createdBy) ?? userIdOfName(r.loggedBy) ?? userIdOfName(r.by);
  for (const [uid, team] of membersByUid) if (team && !userByTeam.has(team)) adjust("members", uid, `Team name "${team}" has no person in the mapping; their records load without an author`);
  const std = (r: ArtifactRecord): Row => {
    const by = authorOf(r);
    return { legacy_id: r.id, created_at: tsOrNull(r.createdAt) ?? x.exportedAt, created_by: by, updated_at: tsOrNull(r.updatedAt) ?? tsOrNull(r.createdAt) ?? x.exportedAt, updated_by: userIdOfName(r.updatedBy) ?? by };
  };

  // ---------- config ----------
  const config = new Map(C("config").map(c => [c.id, c]));
  const dupes = (config.get("dupes")?.map ?? config.get("dupes")?.dupes ?? {}) as Record<string, { parent?: string }>;
  const platformMap = (config.get("platform")?.map ?? {}) as Record<string, { p?: string[] } | string>;

  // ---------- platforms ----------
  const platforms: Row[] = [];
  const platformIdByName = new Map<string, string>();
  for (const p of C("platforms")) {
    const name = str(p.name) || str(p.platform) || p.id;
    if (platformIdByName.has(name.toLowerCase())) { reject("platforms", p.id, `Duplicate platform name "${name}"`); continue; }
    const id = uuidV7();
    platformIdByName.set(name.toLowerCase(), id);
    platforms.push({ id, ...std(p), name, vendor: orNull(p.vendor), enwage_compatible: Boolean(p.enwageCompatible ?? p.enwage), extra: extraOf(p, ["name", "platform", "vendor", "enwageCompatible", "enwage"]) });
  }

  // ---------- companies, with deals split out ----------
  const companies: Row[] = [];
  const deals: Row[] = [];
  const companyId = new Map<string, string>();
  const dealIdOfCompany = new Map<string, string>();
  const liveDomain = new Map<string, string>();
  const COMPANY_COLS = ["name", "domain", "website", "phone", "type", "channel", "fit", "state", "worksiteEmployees", "platform", "owner", "enwageLead", "enwageWhy", "verifiedAt", "v"];
  const DEAL_COLS = ["offer", "stage", "stageChangedAt", "staffSeats", "managerSeats", "proposalValue", "nextStep", "nextStepDate", "decisionDate", "proposalDueDate", "proposalSentDate",
    "contractDueDate", "contractSentDate", "signatureDueDate", "signedAt", "targetStartDate", "lostReason", "objection", "economicBuyerId", "decisionMakerId", "cad"];
  // Parents first, so a duplicate can point at its parent.
  const ordered = [...C("companies")].sort((a, b) => Number(Boolean(dupes[a.id])) - Number(Boolean(dupes[b.id])) || str(a.createdAt).localeCompare(str(b.createdAt)));
  for (const c of ordered) {
    const name = str(c.name);
    if (!name) { reject("companies", c.id, "No company name"); continue; }
    const id = uuidV7();
    const domain = domainOf(str(c.domain) || str(c.website)) || null;
    let duplicateOf: string | null = null;
    const dupParent = dupes[c.id]?.parent;
    if (dupParent) {
      duplicateOf = companyId.get(dupParent) ?? null;
      if (!duplicateOf) adjust("companies", c.id, "Marked as a duplicate, but its parent was not found; loaded as its own company");
    }
    if (!duplicateOf && domain && liveDomain.has(domain)) {
      duplicateOf = liveDomain.get(domain)!;
      adjust("companies", c.id, `Shares the domain ${domain} with another company; loaded as its duplicate`);
    }
    if (!duplicateOf && domain) liveDomain.set(domain, id);
    const owner = userIdOfName(c.owner);
    if (str(c.owner) && !owner) adjust("companies", c.id, `Owner "${str(c.owner)}" has no person in the mapping; loaded without an owner`);
    const pm = platformMap[c.id];
    const platformName = str(c.platform) && str(c.platform) !== "Unknown" ? str(c.platform) : (typeof pm === "string" ? pm : pm?.p?.[0]) || null;
    companyId.set(c.id, id);
    companies.push({
      id, ...std(c), name, name_normalized: normalizeCompanyName(name), domain, website: orNull(c.website), phone: orNull(c.phone),
      type: orNull(c.type), channel: orNull(c.channel), fit: orNull(c.fit), state: orNull(c.state), worksite_employees: intOrNull(c.worksiteEmployees),
      platform_name: platformName, platform_id: platformName ? platformIdByName.get(platformName.toLowerCase()) ?? null : null,
      owner_id: owner, enwage_lead: Boolean(c.enwageLead), enwage_why: orNull(c.enwageWhy), verified_on: dateOrNull(c.verifiedAt ?? c.v),
      duplicate_of: duplicateOf, extra: extraOf(c, [...COMPANY_COLS, ...DEAL_COLS])
    });
    const stage = (STAGES as readonly string[]).includes(str(c.stage)) ? (str(c.stage) as Stage) : "Target";
    if (str(c.stage) && stage !== str(c.stage)) adjust("companies", c.id, `Unknown stage "${str(c.stage)}"; loaded as Target`);
    const hasDealData = stage !== "Target" || Number(c.staffSeats) > 0 || Number(c.managerSeats) > 0 || str(c.nextStep);
    if (hasDealData && !duplicateOf) {
      const dealId = uuidV7();
      dealIdOfCompany.set(c.id, dealId);
      const cad = c.cad as { stage?: string; done?: number[] } | undefined;
      deals.push({
        id: dealId, ...std(c), legacy_id: `deal:${c.id}`, company_id: id, offer: orNull(c.offer), stage,
        stage_changed_on: dateOrNull(c.stageChangedAt) ?? dateOrNull(c.createdAt) ?? x.exportedAt.slice(0, 10), owner_id: owner,
        staff_seats: intOrNull(c.staffSeats) ?? 0, manager_seats: intOrNull(c.managerSeats) ?? 0, expected_monthly_cents: dollarsToCents(c.proposalValue),
        next_step: orNull(c.nextStep), next_step_on: dateOrNull(c.nextStepDate), decision_on: dateOrNull(c.decisionDate),
        proposal_due_on: dateOrNull(c.proposalDueDate), proposal_sent_on: dateOrNull(c.proposalSentDate), contract_due_on: dateOrNull(c.contractDueDate),
        contract_sent_on: dateOrNull(c.contractSentDate), signature_due_on: dateOrNull(c.signatureDueDate), signed_on: dateOrNull(c.signedAt),
        target_start_on: dateOrNull(c.targetStartDate), lost_reason: orNull(c.lostReason), objection: orNull(c.objection),
        cadence_stage: cad && (STAGES as readonly string[]).includes(str(cad.stage)) ? cad.stage : null,
        cadence_done: Array.isArray(cad?.done) ? cad!.done!.filter(n => Number.isInteger(n) && n >= 0) : [],
        extra: {}
      });
    } else if (hasDealData) {
      adjust("companies", c.id, "Duplicate company had deal data; the deal stays on the parent company only");
    }
  }

  // ---------- contacts ----------
  const contacts: Row[] = [];
  const contactId = new Map<string, string>();
  const seenContactEmail = new Set<string>();
  for (const k of C("contacts")) {
    const co = companyId.get(str(k.companyId));
    if (!co) { reject("contacts", k.id, "Company not found"); continue; }
    let email: string | null = str(k.email) ? normalizeEmail(str(k.email)) : null;
    if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) { adjust("contacts", k.id, "Invalid email cleared"); email = null; }
    const extra = extraOf(k, ["companyId", "name", "email", "phone", "title", "role", "linkedin", "emailStatus", "source"]);
    if (email && seenContactEmail.has(email)) { adjust("contacts", k.id, `Email ${email} already belongs to another contact; cleared on this one`); extra.duplicateEmail = email; email = null; }
    if (email) seenContactEmail.add(email);
    const id = uuidV7();
    contactId.set(k.id, id);
    contacts.push({ id, ...std(k), company_id: co, name: str(k.name) || "(no name)", email, phone: orNull(k.phone), title: orNull(k.title), role: orNull(k.role),
      linkedin: orNull(k.linkedin), email_status: orNull(k.emailStatus), source: orNull(k.source), extra });
  }
  // Deal buyer links now that contacts have ids.
  for (const c of C("companies")) {
    const d = deals.find(r => r.id === dealIdOfCompany.get(c.id));
    if (!d) continue;
    d.economic_buyer_id = contactId.get(str(c.economicBuyerId)) ?? null;
    d.decision_maker_id = contactId.get(str(c.decisionMakerId)) ?? null;
  }

  // ---------- activities (append-only) ----------
  const activities: Row[] = [];
  const perPersonWeek: Record<string, number> = {};
  for (const a of C("activities")) {
    const date = dateOrNull(a.date);
    if (!date) { reject("activities", a.id, "No valid date"); continue; }
    const co = str(a.companyId) ? companyId.get(str(a.companyId)) ?? null : null;
    if (str(a.companyId) && !co) { reject("activities", a.id, "Company not found"); continue; }
    const by = authorOf(a);
    const n = touchCount({ count: a.count as number | string | undefined });
    activities.push({
      id: uuidV7(), legacy_id: a.id, created_at: tsOrNull(a.createdAt) ?? `${date}T12:00:00.000Z`, created_by: by,
      company_id: co, deal_id: (co && dealIdOfCompany.get(str(a.companyId))) ?? null, contact_id: contactId.get(str(a.contactId)) ?? null,
      type: str(a.type) || "Note", direction: ["Inbound", "Outbound"].includes(str(a.direction)) ? str(a.direction) : null,
      outcome: ["Positive", "Neutral", "Negative", "No answer"].includes(str(a.outcome)) ? str(a.outcome) : null,
      objection: orNull(a.objection), touch_count: n, occurred_on: date, summary: orNull(a.summary), source: orNull(a.source),
      extra: extraOf(a, ["companyId", "contactId", "type", "direction", "outcome", "objection", "count", "date", "summary", "source", "by"])
    });
    const who = str(a.by) || str(a.loggedBy) || "(unknown)";
    const key = `${who} | ${weekStart(date)}`;
    perPersonWeek[key] = (perPersonWeek[key] ?? 0) + n;
  }

  // ---------- tasks ----------
  const tasks: Row[] = [];
  for (const t of C("tasks")) {
    const title = str(t.title);
    if (!title) { reject("tasks", t.id, "No title"); continue; }
    const co = str(t.companyId) ? companyId.get(str(t.companyId)) ?? null : null;
    if (str(t.companyId) && !co) adjust("tasks", t.id, "Company not found; task kept without a company");
    tasks.push({ id: uuidV7(), ...std(t), title, assignee_id: userIdOfName(t.owner), due_on: dateOrNull(t.due),
      done_at: t.done ? tsOrNull(t.doneAt) ?? x.exportedAt : null, source: str(t.source) === "Cadence" ? "cadence" : str(t.source) === "AI" ? "ai" : "manual",
      company_id: co, deal_id: co ? dealIdOfCompany.get(str(t.companyId)) ?? null : null, notes: orNull(t.notes),
      extra: extraOf(t, ["title", "owner", "due", "done", "doneAt", "source", "companyId", "notes"]) });
  }

  // ---------- outreach ----------
  const outreach: Row[] = [];
  for (const o of C("outreach")) {
    const co = str(o.companyId) ? companyId.get(str(o.companyId)) ?? null : null;
    if (str(o.companyId) && !co) { reject("outreach", o.id, "Company not found"); continue; }
    outreach.push({ id: uuidV7(), ...std(o), company_id: co, contact_id: contactId.get(str(o.contactId)) ?? null, sequence: orNull(o.sequence), channel: orNull(o.channel) ?? "Email",
      planned_on: dateOrNull(o.enrolledAt), status: str(o.status) || "Enrolled", last_event_on: dateOrNull(o.lastEventAt),
      extra: extraOf(o, ["companyId", "contactId", "sequence", "channel", "enrolledAt", "status", "lastEventAt"]) });
  }

  // ---------- proposals and versions ----------
  const proposals: Row[] = [];
  const versions: Row[] = [];
  const proposalId = new Map<string, string>();
  const numbers = new Set<string>();
  for (const p of C("proposals")) {
    const co = companyId.get(str(p.companyId));
    if (!co) { reject("proposals", p.id, "Company not found"); continue; }
    let number = str(p.number) || `LEGACY-${p.id}`;
    if (numbers.has(number)) { adjust("proposals", p.id, `Proposal number ${number} repeated; suffixed`); number = `${number}-${p.id.slice(0, 6)}`; }
    numbers.add(number);
    const id = uuidV7();
    proposalId.set(p.id, id);
    const sent = str(p.status) === "Sent";
    proposals.push({ id, ...std(p), company_id: co, deal_id: dealIdOfCompany.get(str(p.companyId)) ?? null, number, status: sent ? "Sent" : "Draft",
      latest_version: intOrNull(p.version) ?? 0, sent_version: intOrNull(p.sentVersion), sent_at: sent ? tsOrNull(p.sentAt) : null,
      monthly_cents: dollarsToCents(p.monthly) ?? 0, extra: extraOf(p, ["companyId", "number", "status", "version", "sentVersion", "sentAt", "monthly"]) });
  }
  const seenVersion = new Set<string>();
  for (const v of C("proposalVersions")) {
    const pid = proposalId.get(str(v.proposalId));
    if (!pid) { reject("proposalVersions", v.id, "Proposal not found"); continue; }
    const n = intOrNull(v.v);
    if (!n) { reject("proposalVersions", v.id, "No version number"); continue; }
    if (seenVersion.has(`${pid}:${n}`)) { reject("proposalVersions", v.id, `Version ${n} appears twice for this proposal`); continue; }
    seenVersion.add(`${pid}:${n}`);
    versions.push({ id: uuidV7(), legacy_id: v.id, created_at: tsOrNull(v.createdAt) ?? x.exportedAt, created_by: userIdOfName(v.by) ?? authorOf(v),
      proposal_id: pid, v: n, snapshot: v.snap ?? {}, monthly_cents: dollarsToCents(v.monthly) ?? 0, note: orNull(v.note) });
  }

  // ---------- clients, partners, referrals ----------
  const clients: Row[] = [];
  for (const c of C("clients")) {
    const name = str(c.name);
    if (!name) { reject("clients", c.id, "No name"); continue; }
    const d = domainOf(str(c.domain) || str(c.website));
    const co = d ? liveDomain.get(d) ?? null : null;
    clients.push({ id: uuidV7(), ...std(c), name, company_id: co, started_on: dateOrNull(c.since), extra: extraOf(c, ["name", "since"]) });
  }
  const partners: Row[] = [];
  const partnerId = new Map<string, string>();
  for (const b of C("brokers")) {
    const name = str(b.name) || str(b.company);
    if (!name) { reject("brokers", b.id, "No name"); continue; }
    const id = uuidV7();
    partnerId.set(b.id, id);
    partners.push({ id, ...std(b), name, kind: orNull(b.kind ?? b.type) ?? "PEO broker", website: orNull(b.website), domain: domainOf(str(b.domain) || str(b.website)) || null,
      is_peo_broker: b.is_peo_broker !== false, extra: extraOf(b, ["name", "company", "kind", "type", "website", "domain", "is_peo_broker"]) });
  }
  const referrals: Row[] = [];
  for (const r of C("referrals")) {
    const pid = partnerId.get(str(r.brokerId));
    if (!pid) adjust("referrals", r.id, "Broker not found; referral kept without a partner");
    referrals.push({ id: uuidV7(), ...std(r), partner_id: pid ?? null, company_id: companyId.get(str(r.companyId)) ?? null, status: str(r.status) || "Introduced",
      introduced_on: dateOrNull(r.introDate), payout_cents: null, paid_on: dateOrNull(r.paidDate),
      extra: extraOf(r, ["brokerId", "companyId", "status", "introDate", "paidDate"]) });
  }

  // ---------- triggers (database rows plus the seeded ones kept in config) ----------
  const triggers: Row[] = [];
  const addTrigger = (t: ArtifactRecord, co: string | undefined, coll: string) => {
    if (!co) { reject(coll, t.id, "Company not found"); return; }
    const d = str(t.date);
    const month = /^\d{4}-\d{2}$/.test(d);
    const src = str(t.source ?? t.url);
    triggers.push({ id: uuidV7(), ...std(t), company_id: co, type: str(t.type) || "Other", text: str(t.text) || "(no text)",
      source_url: isUrl(src) ? src : null, occurred_on: month ? `${d}-15` : dateOrNull(d), date_precision: month ? "month" : "day",
      extra: extraOf(t, ["companyId", "type", "text", "date", "source", "url", ...(isUrl(src) ? [] : ["source"])]) });
    if (src && !isUrl(src)) (triggers[triggers.length - 1]!.extra as Row).source = src;
  };
  for (const t of C("triggers")) addTrigger(t, companyId.get(str(t.companyId)), "triggers");
  const seeded = (config.get("triggers")?.map ?? {}) as Record<string, Row[]>;
  for (const [cid, list] of Object.entries(seeded)) (list ?? []).forEach((t, i) => addTrigger({ id: `seed:${cid}:${i}`, ...t } as ArtifactRecord, companyId.get(cid), "config/triggers"));

  // ---------- proof, reviews, research ----------
  const proof = C("proof").map(p => ({ id: uuidV7(), ...std(p), kind: str(p.kind) || "Other", title: str(p.title) || "(untitled)", status: str(p.status) || "Idea",
    blob_path: null, extra: extraOf(p, ["kind", "title", "status"]) }));
  const reviews = C("reviews").map(r => ({ id: uuidV7(), ...std(r), kind: str(r.kind) || "pace", text: str(r.text), status: "Draft", extra: extraOf(r, ["kind", "text"]) }));
  const research: Row[] = [];
  for (const r of C("research")) {
    const co = companyId.get(str(r.companyId) || r.id);
    if (!co) { reject("research", r.id, "Company not found"); continue; }
    research.push({ id: uuidV7(), ...std(r), company_id: co, summary: orNull(r.summary ?? r.text), sources: Array.isArray(r.sources) ? r.sources : [],
      ai_drafted: true, extra: extraOf(r, ["companyId", "summary", "text", "sources"]) });
  }

  // ---------- config tables ----------
  const cfgRows: [string, Row[]][] = [];
  const asOf = x.exportedAt.slice(0, 10);
  const tpl = config.get("proposalTemplate");
  if (tpl) {
    const items = Array.isArray(tpl.items) ? (tpl.items as Row[]) : [];
    cfgRows.push(["config_proposal_template", [{ id: uuidV7(), subject: str(tpl.subject), intro: str(tpl.intro), scope: str(tpl.scope), pilot_text: str(tpl.pilotText),
      terms: str(tpl.terms), closing: str(tpl.closing), valid_days: intOrNull(tpl.validDays) ?? 14, effective_from: asOf,
      lines: items.map(i => ({ service: str(i.svc), kind: str(i.kind), seats: intOrNull(i.seats) ?? 0, priceCents: dollarsToCents(i.price) ?? 0 })) }]]);
  }
  const fc = config.get("forecast");
  if (fc) notMigrated.push({ what: "config/forecast", why: "Loaded into config_plan.forecast by the seed step, which needs the plan dates; values kept in the report" });
  cfgRows.push(["config_team", [...userByTeam].map(([team, uid]) => ({ id: uuidV7(), user_id: uid, display_name: team, effective_from: asOf }))]);
  if (config.get("roles")) notMigrated.push({ what: "config/roles", why: "Replaced by server-enforced roles (owner, admin, bd_support, specialist, read_only)" });
  if (config.get("coverage")) notMigrated.push({ what: "config/coverage", why: "Derived from contacts; recomputed" });

  // ---------- audit history ----------
  const auditRows: Row[] = [];
  for (const day of C("auditDays")) {
    for (const e of (day.events as Row[] | undefined) ?? []) {
      const f = (e.f ?? {}) as Record<string, [unknown, unknown]>;
      const keys = Object.keys(f);
      auditRows.push({
        occurred_at: tsOrNull(e.t) ?? x.exportedAt, actor_type: "person", actor_id: userIdOfUid(e.u ?? day.user), action: `legacy:${str(e.act)}`,
        entity: str(e.col) || "unknown", entity_id: orNull(e.id), reason: "Imported from the artifact audit trail",
        before: keys.length ? Object.fromEntries(keys.map(k => [k, f[k]![0]])) : null,
        after: { ...(keys.length ? Object.fromEntries(keys.map(k => [k, f[k]![1]])) : {}), _legacy: { hash: e.h ?? null, prev: e.p ?? null, label: e.label ?? null, who: e.who ?? null } }
      });
    }
  }
  if (C("auditDays").length) notMigrated.push({ what: "audit hash chain", why: "Old entries are imported with their hashes in after._legacy for reference; the new audit log is protected by append-only rules and nightly immutable export instead" });

  // ---------- report ----------
  const dealsPerStage: Record<string, number> = {};
  for (const d of deals) dealsPerStage[str(d.stage)] = (dealsPerStage[str(d.stage)] ?? 0) + 1;
  const sentProps = proposals.filter(p => p.status === "Sent");
  const tables: [string, Row[]][] = [
    ["users", users], ["role_assignments", roleRows], ["platforms", platforms], ["companies", companies], ["contacts", contacts], ["deals", deals],
    ["activities", activities], ["tasks", tasks], ["outreach_steps", outreach], ["proposals", proposals], ["proposal_versions", versions],
    ["clients", clients], ["partners", partners], ["referrals", referrals], ["triggers", triggers], ["proof_assets", proof], ["reviews", reviews],
    ["research", research], ...cfgRows, ["audit_log", auditRows]
  ];
  const inCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(x.collections)) inCounts[k] = v?.length ?? 0;
  const report: ReconciliationReport = {
    exportedAt: x.exportedAt, in: inCounts, out: Object.fromEntries(tables.map(([t, rows]) => [t, rows.length])), rejected, adjusted, notMigrated,
    dealsPerStage, activitiesPerPersonPerWeek: perPersonWeek,
    proposals: { total: proposals.length, sent: sentProps.length, versions: versions.length, monthlyCentsSent: sentProps.reduce((s, p) => s + Number(p.monthly_cents), 0) },
    clients: clients.length
  };
  if (fc) (report as unknown as Row).forecastSettings = extraOf(fc, []);
  return { tables, report };
}
