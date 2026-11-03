import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  CHANNELS, COMPANY_TYPES, COMPETING_OPTIONS, CONTACT_ROLES, FITS, LOGGABLE_ACTIVITY_TYPES, LOST_REASONS, OBJECTIONS, OFFERS, OUTCOMES,
  PILOT_STATUSES, PLATFORMS, STAGES, drawerAbilities, formatDollars, monthlyValueCents, needsNextStep, type Stage
} from "@ostcrm/domain";
import { messageFor } from "../api/client.js";
import { todayLocal, useApp } from "../context.js";

// ---------- shapes from GET /v1/companies/:id/detail ----------
interface Deal {
  id: string; version: number; stage: Stage; offer: string | null; ownerId: string | null; staffSeats: number; managerSeats: number;
  proposalValueCents: number | null; nextStep: string | null; nextStepOn: string | null; decisionOn: string | null; targetStartOn: string | null;
  proposalSentOn: string | null; stageChangedOn: string | null; signedOn: string | null; lostReason: string | null;
  decisionMakerId: string | null; economicBuyerId: string | null;
}
interface Contact { id: string; name: string; title: string | null; role: string | null; email: string | null; phone: string | null; linkedin: string | null; verified_on: string | null; stale: boolean; bucket: string | null; version: number }
interface Activity { id: string; type: string; direction: string | null; outcome: string | null; objection: string | null; occurred_on: string; summary: string | null; by_name: string | null }
interface Task { id: string; title: string; due_on: string | null; done_at: string | null; assignee_name: string | null; version: number }
interface Trigger { id: string; type: string; text: string; source_url: string | null; occurred_on: string | null }
interface Detail {
  company: {
    id: string; version: number; name: string; type: string | null; classifiedType: string | null; channel: string | null; fit: string | null; fitReason: string | null;
    platform: string | null; platformSource: string | null; worksiteEmployees: number | null; state: string | null; website: string | null; domain: string | null;
    phone: string | null; ownerId: string | null; ownerName: string | null; enwageLead: boolean; enwageWhy: string | null; notes: Record<string, string | null>;
    research: {
      hqCity: string | null; hqState: string | null; reach: string | null; reachBasis: string | null; lines: string[]; parentName: string | null; relatedNote: string | null;
      founded: number | null; size: string | null; employees: number | null; annualRevenueCents: number | null; sizeSource: string | null;
      hiringSignal: string | null; hiringCategories: string[]; hiringJobs: number | null; researchPriority: number | null; bestOffer: string | null;
      source: string | null; checkedOn: string | null;
    };
    group: { name: string; note: string | null; lines: string[]; members: { id: string; name: string; type: string | null; classified_type: string | null; reach: string | null; hq_city: string | null; hq_state: string | null; related_note: string | null }[] } | null;
    duplicateOf: { id: string; name: string } | null;
    duplicates: { id: string; name: string; domain: string | null }[];
  };
  deal: Deal | null; valueCents: number; health: { level: "good" | "warn" | "bad"; reasons: string[] };
  contacts: Contact[]; activities: Activity[]; tasks: Task[]; triggers: Trigger[];
}
interface Person { id: string; name: string }

const BUCKET: Record<string, string> = { buyer: "Economic buyer", champion: "Champion", finance: "Finance" };
const fmt = (d: string | null | undefined) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

/** Opens the drawer for a company from any screen: `?co=<id>` on the current screen, so Back closes it. */
export function useOpenCompany() {
  const navigate = useNavigate();
  return (id: string | "new") => navigate({ to: ".", search: (s: Record<string, unknown>) => ({ ...s, co: id }) } as never);
}

/** Rendered by the shell on every screen; shows the drawer when `?co=` is set. */
export function DrawerHost() {
  const search = useSearch({ strict: false }) as { co?: string };
  const navigate = useNavigate();
  if (!search.co) return null;
  const close = () => navigate({ to: ".", search: (s: Record<string, unknown>) => { const { co: _c, ...rest } = s; return rest; } } as never);
  return <CompanyDrawer id={search.co} onClose={close} />;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={wide ? "wide" : undefined}>{label}{children}</label>;
}
const Opts = ({ list, blank = "" }: { list: readonly string[]; blank?: string | null }) => <>{blank !== null && <option value="">{blank}</option>}{list.map(o => <option key={o}>{o}</option>)}</>;

export function CompanyDrawer({ id, onClose }: { id: string; onClose(): void }) {
  const { api, me } = useApp();
  const qc = useQueryClient();
  const today = todayLocal();
  const isNew = id === "new";
  const q = useQuery({ queryKey: ["company", id], queryFn: () => api.get<Detail>(`/v1/companies/${id}/detail?today=${today}`), enabled: !isNew });
  const people = useQuery({ queryKey: ["users"], queryFn: () => api.get<Person[]>("/v1/users"), staleTime: 300_000 });
  const panel = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState("");
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(""), 4000); return () => clearTimeout(t); }, [saved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const d = q.data;
  const can = drawerAbilities(me.role, isNew || d?.deal?.ownerId === me.id);
  const refresh = (next?: Detail) => {
    if (next) qc.setQueryData(["company", next.company.id], next); else void qc.invalidateQueries({ queryKey: ["company", id] });
    void qc.invalidateQueries({ queryKey: ["prospects"] });
    void qc.invalidateQueries({ queryKey: ["pipeline"] });
  };

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title" ref={panel}>
        <div className="drawer-head"><h2 id="d-title">{isNew ? "New prospect" : d?.company.name ?? "Prospect"}</h2><button type="button" onClick={onClose}>Close</button></div>
        {q.isError && <p className="err" role="alert">{messageFor(q.error, "load this company")}</p>}
        {!isNew && q.isPending && <p className="muted">Loading…</p>}
        {(isNew || d) && (
          <>
            {d && <Family d={d} />}
            {d && <Research d={d} />}
            {d?.deal && <Cadence d={d} can={can.editDeal} today={today} onDone={refresh} />}
            <DealForm key={`${d?.company.version}-${d?.deal?.version}`} d={d ?? null} people={people.data ?? []} can={can} today={today}
              saved={saved} onSaved={(next, note) => { setSaved(note); refresh(next); }} />
            {d && <ActivityPanel d={d} can={can.logActivity} today={today} onDone={refresh} />}
            {d && <Contacts d={d} can={can.editContacts} today={today} onDone={refresh} />}
            {d && <Tasks d={d} can={can.manageTasks} people={people.data ?? []} today={today} onDone={refresh} />}
            {d && can.archive && <Archive d={d} onDone={() => { refresh(); onClose(); }} />}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- research, family, duplicates ----------
function Family({ d }: { d: Detail }) {
  const open = useOpenCompany();
  const g = d.company.group;
  const dupOf = d.company.duplicateOf;
  if (!g && !dupOf && !d.company.duplicates.length) return null;
  return (
    <div className="panel family">
      {dupOf && <p className="small" style={{ margin: "0 0 8px" }}><span className="pill warn">Duplicate</span> of <a href="#" onClick={e => { e.preventDefault(); open(dupOf.id); }}><b>{dupOf.name}</b></a>. Work the deal there.</p>}
      {d.company.duplicates.length > 0 && <p className="small" style={{ margin: "0 0 8px" }}>Duplicate records linked here: {d.company.duplicates.map((x, i) => <span key={x.id}>{i ? ", " : ""}<a href="#" onClick={e => { e.preventDefault(); open(x.id); }}>{x.name}</a></span>)}</p>}
      {g && <>
        <h3 style={{ marginTop: 0 }}>Corporate family: {g.name}</h3>
        {g.note && <p className="small muted" style={{ margin: "0 0 8px" }}>{g.note}</p>}
        {g.lines?.length > 0 && <p className="small" style={{ margin: "0 0 8px" }}>Lines across the group: {g.lines.join(", ")}</p>}
        {g.members.length ? g.members.map(o => (
          <div key={o.id} className="item small"><a href="#" onClick={e => { e.preventDefault(); open(o.id); }}><b>{o.name}</b></a>&nbsp;
            <span className="muted">{[o.classified_type || o.type, o.reach, [o.hq_city, o.hq_state].filter(Boolean).join(", ")].filter(Boolean).join(", ")}</span>
            {o.related_note && <span className="muted"> ({o.related_note})</span>}</div>
        )) : <p className="small muted" style={{ margin: 0 }}>No other group members are in the CRM.</p>}
      </>}
    </div>
  );
}

function Research({ d }: { d: Detail }) {
  const r = d.company.research;
  const rows: [string, ReactNode][] = [];
  const add = (k: string, v: ReactNode) => { if (v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) rows.push([k, v]); };
  add("Researched type", d.company.classifiedType);
  add("Headquarters", [r.hqCity, r.hqState].filter(Boolean).join(", "));
  add("Reach", r.reach ? `${r.reach}${r.reachBasis ? ` (${r.reachBasis})` : ""}` : null);
  add("Lines of business", r.lines?.join(", "));
  add("Parent", r.parentName);
  add("Related", r.relatedNote);
  add("Founded", r.founded);
  const size = [r.size, r.employees ? `${r.employees.toLocaleString()} employees` : null, r.annualRevenueCents ? `${formatDollars(r.annualRevenueCents)} revenue` : null].filter(Boolean).join(", ");
  add("Size", size ? size + (r.sizeSource ? ` (${r.sizeSource})` : "") : null);
  add("Hiring", r.hiringSignal ? `${r.hiringSignal}${r.hiringJobs ? `, ${r.hiringJobs} open roles` : ""}${r.hiringCategories?.length ? ` in ${r.hiringCategories.join(", ")}` : ""}` : null);
  add("Research priority", r.researchPriority ? `P${r.researchPriority}` : null);
  add("Best offer", r.bestOffer);
  add("Platform", d.company.platform ? `${d.company.platform}${d.company.platformSource ? ` (from ${d.company.platformSource})` : ""}` : null);
  if (!rows.length && !d.triggers.length) return null;
  return (
    <div className="panel research">
      <h3 style={{ marginTop: 0 }}>Research</h3>
      {rows.length > 0 && <dl className="small" style={{ display: "grid", gridTemplateColumns: "minmax(120px,auto) 1fr", gap: "4px 12px", margin: 0 }}>
        {rows.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt className="muted">{k}</dt><dd style={{ margin: 0 }}>{v}</dd></div>)}
      </dl>}
      {d.triggers.length > 0 && <>
        <h3>Triggers</h3>
        <div className="list">{d.triggers.map(t => (
          <div key={t.id} className="item small"><div className="body"><div className="title">{t.text}</div>
            <div className="meta">{[t.type, fmt(t.occurred_on)].filter(Boolean).join(", ")}{t.source_url && <>, <a href={t.source_url} target="_blank" rel="noopener noreferrer">Source</a></>}</div></div></div>
        ))}</div>
      </>}
      {r.checkedOn && <p className="small muted" style={{ margin: "8px 0 0" }}>Research checked {fmt(r.checkedOn)}{r.source ? `, ${r.source}` : ""}</p>}
    </div>
  );
}

// ---------- the deal form ----------
type Form = Record<string, string | boolean>;
function initial(d: Detail | null, meId: string): Form {
  const c = d?.company, k = d?.deal, n = c?.notes ?? {};
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    name: s(c?.name), type: s(c?.type || (d ? "" : "PEO")), offer: s(k?.offer || (d ? "" : "Year-end surge")), channel: s(c?.channel || (d ? "" : "Warm network")),
    ownerId: s(k?.ownerId ?? c?.ownerId ?? (d ? "" : meId)), stage: s(k?.stage ?? "Target"), platform: s(c?.platform), worksiteEmployees: s(c?.worksiteEmployees),
    state: s(c?.state), website: s(c?.website), staffSeats: s(k?.staffSeats || ""), managerSeats: s(k?.managerSeats || ""), nextStep: s(k?.nextStep), nextStepOn: s(k?.nextStepOn),
    decisionMakerId: s(k?.decisionMakerId), economicBuyerId: s(k?.economicBuyerId), decisionOn: s(k?.decisionOn), targetStartOn: s(k?.targetStartOn),
    currentProvider: s(n.currentProvider), prismModules: s(n.prismModules), competingOption: s(n.competingOption), pilotStatus: s(n.pilotStatus),
    proposalSentOn: s(k?.proposalSentOn), proposalValue: k?.proposalValueCents ? String(Math.round(k.proposalValueCents / 100)) : "",
    fit: s(c?.fit), fitReason: s(c?.fitReason), lostReason: s(k?.lostReason), lostNote: s(n.lostNote), enwageLead: !!c?.enwageLead, enwageWhy: s(c?.enwageWhy),
    pain: s(n.pain), notes: s(n.notes)
  };
}

function DealForm({ d, people, can, today, saved, onSaved }: { d: Detail | null; people: Person[]; can: ReturnType<typeof drawerAbilities>; today: string; saved: string; onSaved(next: Detail, note: string): void }) {
  const { api, me } = useApp();
  const open = useOpenCompany();
  const [f, setF] = useState<Form>(() => initial(d, me.id));
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>(saved ? { ok: saved } : {});
  const set = (k: string) => (e: { target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement }) =>
    setF(x => ({ ...x, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const str = (k: string) => String(f[k] ?? "");
  const num = (k: string) => (str(k) === "" ? null : Number(str(k)));
  const editable = d ? can.editDeal : can.addProspect;
  const companyLocked = !!d && !can.editCompany;
  const value = monthlyValueCents({ staffSeats: Number(str("staffSeats")) || 0, managerSeats: Number(str("managerSeats")) || 0 });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        today, name: str("name").trim(), type: str("type"), channel: str("channel"), platform: str("platform") || null, worksiteEmployees: num("worksiteEmployees"),
        state: str("state") || null, website: str("website") || null, fit: str("fit"), fitReason: str("fitReason") || null, enwageLead: !!f.enwageLead,
        enwageWhy: str("enwageWhy") || null, ownerId: str("ownerId") || null, offer: str("offer"), stage: str("stage"),
        staffSeats: Number(str("staffSeats")) || 0, managerSeats: Number(str("managerSeats")) || 0,
        proposalValueCents: num("proposalValue") === null ? null : Math.round(Number(str("proposalValue")) * 100),
        nextStep: str("nextStep") || null, nextStepOn: str("nextStepOn") || null, decisionOn: str("decisionOn") || null, targetStartOn: str("targetStartOn") || null,
        proposalSentOn: str("proposalSentOn") || null, lostReason: str("lostReason"), decisionMakerId: str("decisionMakerId") || null,
        economicBuyerId: str("economicBuyerId") || null, currentProvider: str("currentProvider") || null, prismModules: str("prismModules") || null,
        competingOption: str("competingOption"), pilotStatus: str("pilotStatus"), lostNote: str("lostNote") || null, pain: str("pain") || null, notes: str("notes") || null
      };
      return d
        ? api.command<Detail>("PUT", `/v1/companies/${d.company.id}/deal`, { ...body, companyVersion: d.company.version, dealVersion: d.deal?.version ?? null })
        : api.command<Detail>("POST", "/v1/companies", body);
    },
    onSuccess: next => { onSaved(next, d ? "Saved" : "Prospect added"); if (!d) open(next.company.id); },
    onError: e => setMsg({ err: messageFor(e, d ? "save" : "add this prospect") })
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setMsg({}); if (!str("name").trim()) { setMsg({ err: "Company name is required." }); return; } save.mutate(); };

  const contactOpts = (d?.contacts ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.title ? `, ${c.title}` : ""}</option>);
  const lockedNote = companyLocked ? "Company fields are changed by BD support, admin or the owner." : "";
  return (
    <div className="panel">
      <form className="form" id="coform" noValidate onSubmit={submit} aria-describedby="c-msg">
        <fieldset disabled={!editable} style={{ display: "contents" }}>
          <h3>Deal</h3>
          <Field label="Company" wide><input value={str("name")} onChange={set("name")} required disabled={companyLocked} /></Field>
          <Field label="Type"><select value={str("type")} onChange={set("type")} disabled={companyLocked}><Opts list={COMPANY_TYPES} /></select></Field>
          <Field label="Offer"><select value={str("offer")} onChange={set("offer")}><Opts list={OFFERS} /></select></Field>
          <Field label="Channel"><select value={str("channel")} onChange={set("channel")} disabled={companyLocked}><Opts list={CHANNELS} /></select></Field>
          <Field label="Owner"><select value={str("ownerId")} onChange={set("ownerId")} disabled={companyLocked}><option value="">No owner</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Stage"><select value={str("stage")} onChange={set("stage")}><Opts list={STAGES} blank={null} /></select></Field>
          <Field label="Platform"><select value={str("platform")} onChange={set("platform")} disabled={companyLocked}><Opts list={str("platform") && !(PLATFORMS as readonly string[]).includes(str("platform")) ? [str("platform"), ...PLATFORMS] : PLATFORMS} /></select></Field>
          <Field label="Worksite employees"><input type="number" min="0" value={str("worksiteEmployees")} onChange={set("worksiteEmployees")} disabled={companyLocked} /></Field>
          <Field label="State"><input maxLength={40} value={str("state")} onChange={set("state")} disabled={companyLocked} /></Field>
          <Field label="Website"><input placeholder="example.com" value={str("website")} onChange={set("website")} disabled={companyLocked} /></Field>
          <Field label="Staff seats"><input type="number" min="0" value={str("staffSeats")} onChange={set("staffSeats")} /></Field>
          <Field label="Manager seats"><input type="number" min="0" value={str("managerSeats")} onChange={set("managerSeats")} /></Field>
          <Field label="Next step" wide><input value={str("nextStep")} onChange={set("nextStep")} /></Field>
          <Field label="Next step date"><input type="date" value={str("nextStepOn")} onChange={set("nextStepOn")} /></Field>
          <h3>Qualification</h3>
          <Field label="Decision maker"><select value={str("decisionMakerId")} onChange={set("decisionMakerId")}><option value="" />{contactOpts}</select></Field>
          <Field label="Economic buyer"><select value={str("economicBuyerId")} onChange={set("economicBuyerId")}><option value="" />{contactOpts}</select></Field>
          <Field label="Decision date"><input type="date" value={str("decisionOn")} onChange={set("decisionOn")} /></Field>
          <Field label="Target start date"><input type="date" value={str("targetStartOn")} onChange={set("targetStartOn")} /></Field>
          <Field label="Current payroll setup"><input placeholder="In-house team of 6, other BPO" value={str("currentProvider")} onChange={set("currentProvider")} disabled={companyLocked} /></Field>
          <Field label="PrismHR version or modules"><input value={str("prismModules")} onChange={set("prismModules")} disabled={companyLocked} /></Field>
          <Field label="Competing option"><select value={str("competingOption")} onChange={set("competingOption")} disabled={companyLocked}><Opts list={COMPETING_OPTIONS} /></select></Field>
          <Field label="Pilot status"><select value={str("pilotStatus")} onChange={set("pilotStatus")} disabled={companyLocked}><Opts list={PILOT_STATUSES} blank="None" /></select></Field>
          <Field label="Proposal sent date"><input type="date" value={str("proposalSentOn")} onChange={set("proposalSentOn")} /></Field>
          <Field label="Proposal value per month ($)"><input type="number" min="0" value={str("proposalValue")} onChange={set("proposalValue")} /></Field>
          <Field label="Fit"><select value={str("fit")} onChange={set("fit")} disabled={companyLocked}><Opts list={FITS} blank="Not set" /></select></Field>
          <Field label="Fit reason" wide><input placeholder="Why this company is or is not a buyer" value={str("fitReason")} onChange={set("fitReason")} disabled={companyLocked} /></Field>
          <Field label="Lost or stalled reason"><select value={str("lostReason")} onChange={set("lostReason")}><Opts list={LOST_REASONS} /></select></Field>
          <Field label="What they said" wide><input placeholder="Their words, for the win/loss review" value={str("lostNote")} onChange={set("lostNote")} disabled={companyLocked} /></Field>
          <label className="chk"><input type="checkbox" checked={!!f.enwageLead} onChange={set("enwageLead")} disabled={companyLocked} /> Enwage software lead</label>
          <Field label="Why Enwage" wide><input placeholder="e.g. Unhappy with isolved support, renewal in March" value={str("enwageWhy")} onChange={set("enwageWhy")} disabled={companyLocked} /></Field>
          <h3>Notes</h3>
          <Field label="Pain, in their words" wide><textarea value={str("pain")} onChange={set("pain")} disabled={companyLocked} /></Field>
          <Field label="Notes" wide><textarea value={str("notes")} onChange={set("notes")} disabled={companyLocked} /></Field>
        </fieldset>
        <div className="actions wide savebar">
          {editable && <button className="primary" type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : d ? "Save" : "Add prospect"}</button>}
          <span className="small muted">{value ? `${formatDollars(value)} per month at founding prices` : ""}</span>
          <span id="c-msg" role="status" className={msg.err ? "err" : "small muted"}>{msg.err ?? msg.ok ?? (editable ? lockedNote : "Your role can view this deal, not change it.")}</span>
        </div>
      </form>
    </div>
  );
}

// ---------- activity ----------
function ActivityPanel({ d, can, today, onDone }: { d: Detail; can: boolean; today: string; onDone(): void }) {
  const { api } = useApp();
  const blank = { type: "Email", direction: "Outbound", outcome: "", objection: "", occurredOn: today, summary: "", nextStep: d.deal?.nextStep ?? "", nextStepOn: d.deal?.nextStepOn ?? "" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  const stage = d.deal?.stage ?? "Target";
  const needsNext = needsNextStep(stage, { type: f.type, direction: f.direction as "Outbound", outcome: f.outcome as "" });
  const log = useMutation({
    mutationFn: () => api.command("POST", "/v1/activities", {
      companyId: d.company.id, type: f.type, direction: f.direction, outcome: f.outcome || null, objection: f.objection || null, occurredOn: f.occurredOn, today,
      summary: f.summary.trim() || null, nextStep: f.nextStep.trim() || null, nextStepOn: f.nextStepOn || null
    }),
    onSuccess: () => { setF(x => ({ ...x, summary: "", objection: "" })); onDone(); },
    onError: e => setErr(messageFor(e, "log this"))
  });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    if (!f.occurredOn) { setErr("Pick a date."); return; }
    if (needsNext && (!f.nextStep.trim() || !f.nextStepOn)) { setErr("This deal is open, so it needs a next step and a date."); return; }
    if (needsNext && f.nextStepOn < today) { setErr("The next step date can't be in the past."); return; }
    log.mutate();
  };
  return (
    <div className="panel">
      <div className="panel-head"><h2>Activity</h2><p>{d.health.level === "good" ? <span className="pill good">Healthy</span> : <span className={`pill ${d.health.level}`}>{d.health.reasons.join("; ")}</span>}</p></div>
      {can && (
        <form className="form" noValidate onSubmit={submit}>
          <Field label="Type"><select value={f.type} onChange={set("type")}><Opts list={LOGGABLE_ACTIVITY_TYPES} blank={null} /></select></Field>
          <Field label="Direction"><select value={f.direction} onChange={set("direction")}><option>Outbound</option><option>Inbound</option></select></Field>
          <Field label="Outcome"><select value={f.outcome} onChange={set("outcome")}><Opts list={OUTCOMES} /></select></Field>
          <Field label="Objection"><select value={f.objection} onChange={set("objection")}><Opts list={OBJECTIONS} /></select></Field>
          <Field label="Date"><input type="date" required value={f.occurredOn} onChange={set("occurredOn")} /></Field>
          <Field label="Summary" wide><textarea value={f.summary} onChange={set("summary")} /></Field>
          <Field label={needsNext ? "Next step (required)" : "Next step"}><input value={f.nextStep} onChange={set("nextStep")} /></Field>
          <Field label="Next step date"><input type="date" value={f.nextStepOn} onChange={set("nextStepOn")} /></Field>
          <div className="actions wide"><button type="submit" className="primary" disabled={log.isPending}>Log</button><span className="err" role="alert">{err}</span></div>
        </form>
      )}
      <div className="list" style={{ marginTop: 10 }}>
        {d.activities.length ? d.activities.map(a => (
          <div key={a.id} className="item"><div className="body">
            <div className="title">{a.type}{a.direction ? ` · ${a.direction}` : ""}{a.outcome ? ` · ${a.outcome}` : ""}{a.objection ? <span className="tag" style={{ marginLeft: 6 }}>{a.objection}</span> : null}</div>
            {a.summary && <div className="small" style={{ whiteSpace: "pre-wrap" }}>{a.summary}</div>}
            <div className="meta">{fmt(a.occurred_on)}{a.by_name ? `, ${a.by_name}` : ""}</div>
          </div></div>
        )) : <div className="empty">No activity yet.</div>}
      </div>
    </div>
  );
}

// ---------- contacts ----------
function Contacts({ d, can, today, onDone }: { d: Detail; can: boolean; today: string; onDone(): void }) {
  const { api } = useApp();
  const [f, setF] = useState({ name: "", title: "", email: "", phone: "", role: "" });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  const add = useMutation({
    mutationFn: () => api.command("POST", "/v1/contacts", { companyId: d.company.id, name: f.name.trim(), title: f.title.trim() || null, email: f.email.trim(), phone: f.phone.trim() || null, role: f.role }),
    onSuccess: () => { setF({ name: "", title: "", email: "", phone: "", role: "" }); onDone(); }, onError: e => setErr(messageFor(e, "add this contact"))
  });
  const act = useMutation({
    mutationFn: ({ c, what }: { c: Contact; what: "checked" | "archive" }) => api.command("POST", `/v1/contacts/${c.id}/${what}`, what === "checked" ? { version: c.version, today } : { version: c.version }),
    onSuccess: onDone, onError: e => setErr(messageFor(e, "change this contact"))
  });
  return (
    <div className="panel">
      <div className="panel-head"><h2>Contacts</h2></div>
      <div className="list">
        {d.contacts.length ? d.contacts.map(c => (
          <div key={c.id} className="item"><div className="body">
            <div className="title">{c.name} {c.role && <span className="tag">{c.role}</span>} {c.bucket && <span className="tag">{BUCKET[c.bucket] ?? c.bucket}</span>}{" "}
              {c.verified_on && <span className={`tag${c.stale ? " stale" : ""}`} title={c.stale ? "Not checked in over 90 days" : "Last checked"}>{c.stale ? "Stale, checked " : "Checked "}{fmt(c.verified_on)}</span>}</div>
            <div className="meta">{[c.title, c.email, c.phone].filter(Boolean).join(", ")}{c.linkedin && <>, <a href={c.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a></>}</div>
          </div>
            {can && <div className="actions"><button type="button" className="small" onClick={() => act.mutate({ c, what: "checked" })}>Mark checked</button><button type="button" className="small" onClick={() => act.mutate({ c, what: "archive" })}>Remove</button></div>}
          </div>
        )) : <div className="empty">No contacts yet.</div>}
      </div>
      {can && (
        <form className="form" style={{ marginTop: 10 }} onSubmit={e => { e.preventDefault(); setErr(""); if (f.name.trim()) add.mutate(); }}>
          <Field label="Name"><input required value={f.name} onChange={set("name")} /></Field>
          <Field label="Title"><input value={f.title} onChange={set("title")} /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Phone"><input value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Role"><select value={f.role} onChange={set("role")}><Opts list={CONTACT_ROLES} blank="From title" /></select></Field>
          <div className="actions"><button type="submit" disabled={add.isPending}>Add contact</button><span className="err" role="alert">{err}</span></div>
        </form>
      )}
    </div>
  );
}

// ---------- tasks ----------
function Tasks({ d, can, people, today, onDone }: { d: Detail; can: boolean; people: Person[]; today: string; onDone(): void }) {
  const { api, me } = useApp();
  const [f, setF] = useState({ title: "", assigneeId: d.deal?.ownerId ?? me.id, dueOn: addDays(today, 1) });
  const [err, setErr] = useState("");
  const add = useMutation({
    mutationFn: () => api.command("POST", "/v1/tasks", { title: f.title.trim(), assigneeId: f.assigneeId || null, dueOn: f.dueOn, companyId: d.company.id }),
    onSuccess: () => { setF(x => ({ ...x, title: "" })); onDone(); }, onError: e => setErr(messageFor(e, "add this task"))
  });
  const tick = useMutation({
    mutationFn: (t: Task) => api.command("POST", `/v1/tasks/${t.id}/done`, { version: t.version, done: !t.done_at }),
    onSuccess: onDone, onError: e => setErr(messageFor(e, "change this task"))
  });
  return (
    <div className="panel">
      <div className="panel-head"><h2>Tasks</h2></div>
      <div className="list">
        {d.tasks.length ? d.tasks.map(t => (
          <div key={t.id} className="item">
            <input type="checkbox" checked={!!t.done_at} disabled={!can || tick.isPending} onChange={() => tick.mutate(t)} aria-label={`Done: ${t.title}`} />
            <div className="body"><div className="title" style={t.done_at ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>{t.title}</div>
              <div className={`meta${!t.done_at && t.due_on && t.due_on < today ? " err" : ""}`}>{[t.assignee_name, t.due_on ? `due ${fmt(t.due_on)}` : ""].filter(Boolean).join(", ")}</div></div>
          </div>
        )) : <div className="empty">No tasks yet.</div>}
      </div>
      {can && (
        <form className="form" style={{ marginTop: 10 }} onSubmit={e => { e.preventDefault(); setErr(""); if (f.title.trim() && f.dueOn) add.mutate(); }}>
          <Field label="Task" wide><input required value={f.title} onChange={e => setF(x => ({ ...x, title: e.target.value }))} /></Field>
          <Field label="Owner"><select value={f.assigneeId} onChange={e => setF(x => ({ ...x, assigneeId: e.target.value }))}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Due"><input type="date" required value={f.dueOn} onChange={e => setF(x => ({ ...x, dueOn: e.target.value }))} /></Field>
          <div className="actions"><button type="submit" disabled={add.isPending}>Add task</button><span className="err" role="alert">{err}</span></div>
        </form>
      )}
    </div>
  );
}

// ---------- archive ----------
function Archive({ d, onDone }: { d: Detail; onDone(): void }) {
  const { api } = useApp();
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  const go = useMutation({
    mutationFn: () => api.command("POST", `/v1/companies/${d.company.id}/archive`, { version: d.company.version, confirm: true }),
    onSuccess: onDone, onError: e => setErr(messageFor(e, "archive this prospect"))
  });
  return (
    <div className="actions">
      <button type="button" className="danger" disabled={go.isPending} onClick={() => (armed ? go.mutate() : setArmed(true))}>{armed ? "Select again to archive" : "Archive prospect"}</button>
      <span className="small muted">Archived prospects leave every list. Activity history is kept.</span>
      <span className="err" role="alert">{err}</span>
    </div>
  );
}

// ---------- cadence and documents due ----------
interface Plan { plan: { steps: { day: number; channel: string; action: string; index: number; due: string; done: boolean }[] }; document: { kind: string; due: string } | null; contractSentOn: string | null }
function Cadence({ d, can, today, onDone }: { d: Detail; can: boolean; today: string; onDone(): void }) {
  const { api } = useApp();
  const deal = d.deal!;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cadence", deal.id, deal.version, today], queryFn: () => api.get<Plan>(`/v1/deals/${deal.id}/cadence?today=${today}`) });
  const [err, setErr] = useState("");
  const [armed, setArmed] = useState(false);
  const after = () => { setErr(""); void qc.invalidateQueries({ queryKey: ["cadence", deal.id] }); onDone(); };
  const tick = useMutation({ mutationFn: (index: number) => api.command("POST", `/v1/deals/${deal.id}/cadence`, { version: deal.version, index, today }), onSuccess: after, onError: e => setErr(messageFor(e, "mark this step done")) });
  const contract = useMutation({ mutationFn: () => api.command("POST", `/v1/deals/${deal.id}/contract-sent`, { version: deal.version, today }), onSuccess: after, onError: e => setErr(messageFor(e, "mark the contract sent")) });
  const p = q.data;
  if (!p) return null;
  const doc = p.document;
  const dd = doc ? Math.round((new Date(today + "T00:00:00").getTime() - new Date(doc.due + "T00:00:00").getTime()) / 86_400_000) : 0;
  return (
    <div className="panel gtm">
      {doc && <p className={`duebar${doc.due < today ? " od" : doc.due === today ? " td" : ""}`}><b>{doc.kind} due {fmt(doc.due)}</b>{doc.due < today ? `, overdue by ${dd} day${dd === 1 ? "" : "s"}` : doc.due === today ? ", today" : ""}</p>}
      {deal.stage === "Verbal yes" && (
        <div className="actions" style={{ margin: "0 0 10px" }}>
          {p.contractSentOn ? <span className="small">Contract sent {fmt(p.contractSentOn)}.</span>
            : can && <button type="button" disabled={contract.isPending} onClick={() => (armed ? contract.mutate() : (setArmed(true), setTimeout(() => setArmed(false), 4000)))}>{armed ? "Select again to confirm" : "Mark contract sent"}</button>}
        </div>
      )}
      <h3 style={{ marginTop: 0 }}>Cadence: {deal.stage}</h3>
      {p.plan.steps.length ? (
        <ol className="cadl">{p.plan.steps.map(s => (
          <li key={s.index} className={s.done ? "done" : s.due < today ? "od" : ""}>
            <span className="chn" data-ch={s.channel}>Day {s.day} · {s.channel}</span> {s.action} <span className="small muted">{s.done ? "done" : `${s.due < today ? "overdue, " : "due "}${fmt(s.due)}`}</span>
            {!s.done && can && (s.channel === "Proposal"
              ? <span className="small muted"> (done when the proposal is sent; proposals are still in the current CRM)</span>
              : <> <button type="button" className="small" disabled={tick.isPending} onClick={() => tick.mutate(s.index)}>Mark done</button></>)}
          </li>
        ))}</ol>
      ) : <p className="small muted">No cadence for this stage. Move the deal to Contacted to start one.</p>}
      <span className="err" role="alert">{err}</span>
    </div>
  );
}
