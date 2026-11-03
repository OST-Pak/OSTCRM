import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { messageFor } from "../api/client.js";
import { todayLocal, useApp } from "../context.js";

interface Prospect {
  id: string; name: string; domain: string | null; website: string | null; type: string; fit: string | null; fitReason: string | null;
  state: string | null; city: string | null; platform: string | null; size: string | null; employees: number | null;
  hiringSignal: string | null; enwage: boolean; duplicate: boolean; owner: string | null; stage: string;
  tier: "A" | "B" | "C" | null; rank: number | null; score: number; why: string[];
  coverage: { buyer: number; champion: number; finance: number; contacts: number }; recentTriggers: number;
}
interface Page { total: number; offset: number; items: Prospect[]; facets: { types: string[]; fits: string[]; states: string[]; tiers: Record<"A" | "B" | "C", number> } }

const PAGE = 100;
const SORTS = [["tier", "Tier"], ["name", "Name"], ["state", "State"], ["size", "Size"]] as const;

/** Prospects: every company, tiered on the server with the same scoring as the current CRM. Read only for now. */
export function Prospects() {
  const { api } = useApp();
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [f, setF] = useState({ tier: "", type: "", fit: "", state: "", sort: "tier" });
  const [offset, setOffset] = useState(0);
  useEffect(() => { const t = setTimeout(() => setQ(typed.trim()), 250); return () => clearTimeout(t); }, [typed]);
  useEffect(() => { setOffset(0); }, [q, f]);

  const params = new URLSearchParams({ today: todayLocal(), offset: String(offset), limit: String(PAGE), sort: f.sort });
  if (q) params.set("q", q);
  for (const k of ["tier", "type", "fit", "state"] as const) if (f[k]) params.set(k, f[k]);
  const r = useQuery({ queryKey: ["prospects", params.toString()], queryFn: () => api.get<Page>(`/v1/prospects?${params}`), placeholderData: keepPreviousData });
  const d = r.data;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <section className="panel">
      <h2>Prospects</h2>
      {d && <p className="muted small">Tier A {d.facets.tiers.A} · Tier B {d.facets.tiers.B} · Tier C {d.facets.tiers.C}. Tiers rank every eligible account; partners, clients, unfit, closed and duplicate records have none.</p>}
      <div className="toolbar">
        <label className="grow">Search<input type="search" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Name or website" /></label>
        <label>Tier<select value={f.tier} onChange={set("tier")}><option value="">All</option><option>A</option><option>B</option><option>C</option><option value="none">No tier</option></select></label>
        <label>Type<select value={f.type} onChange={set("type")}><option value="">All</option>{d?.facets.types.map(t => <option key={t}>{t}</option>)}</select></label>
        <label>Fit<select value={f.fit} onChange={set("fit")}><option value="">All</option>{d?.facets.fits.map(t => <option key={t}>{t}</option>)}</select></label>
        <label>State<select value={f.state} onChange={set("state")}><option value="">All</option>{d?.facets.states.map(t => <option key={t}>{t}</option>)}</select></label>
        <label>Sort<select value={f.sort} onChange={set("sort")}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      {r.isError && <p className="pill bad" role="alert">{messageFor(r.error, "load prospects")}</p>}
      {r.isPending && <p className="muted">Loading…</p>}
      {d && (
        <>
          <p className="small muted" aria-live="polite">{d.total === 0 ? "No companies match." : `Showing ${d.offset + 1} to ${Math.min(d.offset + PAGE, d.total)} of ${d.total}`}</p>
          <div className="tscroll">
            <table>
              <thead><tr><th>Tier</th><th>Company</th><th>Type</th><th>Fit</th><th>State</th><th>Platform</th><th>Size</th><th>Stage</th><th className="r">Contacts</th><th>Owner</th></tr></thead>
              <tbody>
                {d.items.map(p => (
                  <tr key={p.id}>
                    <td><span className={`tier${p.tier ? " t" + p.tier : ""}`} title={p.why.join(", ")}>{p.tier ?? "–"}</span></td>
                    <td><b>{p.name}</b>{p.domain && <div className="small muted">{p.domain}</div>}
                      {p.enwage && <span className="pill neutral">Enwage</span>} {p.duplicate && <span className="pill warn">Duplicate</span>} {p.recentTriggers > 0 && <span className="pill good">Trigger</span>}</td>
                    <td>{p.type || "–"}</td>
                    <td>{p.fit ? <span className={`pill ${p.fit === "Not a fit" ? "bad" : p.fit === "Review" ? "warn" : "neutral"}`} title={p.fitReason ?? ""}>{p.fit}</span> : "–"}</td>
                    <td>{[p.city, p.state].filter(Boolean).join(", ") || "–"}</td>
                    <td>{p.platform || "–"}</td>
                    <td>{p.size || "–"}{p.employees ? <div className="small muted">{p.employees.toLocaleString()} staff</div> : null}</td>
                    <td>{p.stage}</td>
                    <td className="r">{p.coverage.contacts}</td>
                    <td>{p.owner || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.total > PAGE && (
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <button type="button" disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
