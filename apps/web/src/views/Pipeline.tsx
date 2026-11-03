import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDollars } from "@ostcrm/domain";
import { messageFor } from "../api/client.js";
import { todayLocal, useApp } from "../context.js";
import { useOpenCompany } from "./CompanyDrawer.js";

interface Step { day: number; channel: string; action: string }
interface Card { id: string; name: string; ownerName: string | null; daysInStage: number; daysSinceTouch: number | null; valueCents: number; overdue: boolean; next: (Step & { index: number; due: string; total: number }) | null }
interface Board {
  columns: { stage: string; count: number; valueCents: number; cards: Card[] }[]; open: number; overdue: number;
  documents: { id: string; name: string; kind: string; due: string; status: "overdue" | "today" | "upcoming"; days: number; valueCents: number }[];
  owners: { id: string; name: string }[]; cadence: { stage: string; steps: Step[] }[];
}
const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const DUE_LABEL: Record<string, string> = { Proposal: "Proposal due", Contract: "Contract due", Decision: "Decision due", Signature: "Signature due" };

/** Sales pipeline: the board with each deal's next cadence step, documents due, and the cadence itself. Proposals come with the Proposals port. */
export function Pipeline() {
  const { api } = useApp();
  const open = useOpenCompany();
  const [owner, setOwner] = useState("");
  const today = todayLocal();
  const q = useQuery({ queryKey: ["pipeline", owner, today], queryFn: () => api.get<Board>(`/v1/pipeline?today=${today}${owner ? `&ownerId=${owner}` : ""}`) });
  const b = q.data;
  return (
    <>
      <section className="panel">
        <div className="panel-head"><div><h2>Sales pipeline</h2><p className="sub-h">Each card shows its next cadence step and when it is due. Open a card to tick steps off.</p></div>
          {b && <p>{b.open} open deals, {b.overdue} with an overdue cadence step</p>}</div>
        <div className="toolbar"><label className="narrow">Owner<select value={owner} onChange={e => setOwner(e.target.value)}><option value="">Everyone</option>{b?.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div>
        {q.isError && <p className="err" role="alert">{messageFor(q.error, "load the pipeline")}</p>}
        {q.isPending && <p className="muted">Loading…</p>}
        {b && (
          <div className="pboard">
            {b.columns.map(c => (
              <section key={c.stage} className="pcol" data-s={c.stage} aria-label={`${c.stage}, ${c.count} deals`}>
                <header><b>{c.stage}</b><span>{c.count}{c.valueCents ? ` · ${formatDollars(c.valueCents)}` : ""}</span></header>
                {c.cards.length ? c.cards.map(k => (
                  <article key={k.id} className={`pcard${k.overdue ? " od" : ""}`} tabIndex={0} role="button"
                    onClick={() => open(k.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(k.id); } }}>
                    <b>{k.name}</b>
                    <div className="small muted">{k.daysInStage}d in stage{k.daysSinceTouch !== null ? `, touched ${k.daysSinceTouch}d ago` : ", no touch logged"}{k.valueCents ? `, ${formatDollars(k.valueCents)}/mo` : ""}{k.ownerName ? `, ${k.ownerName}` : ""}</div>
                    {k.next
                      ? <div className="pnext"><span className="chn" data-ch={k.next.channel}>{k.next.channel}</span> {k.next.action}
                          <div className={`small ${k.overdue ? "badc" : "muted"}`}>{k.overdue ? "Overdue since " : "Due "}{fmt(k.next.due)} <span className="nw">· step {k.next.index + 1} of {k.next.total}</span></div></div>
                      : <div className="small muted">Cadence complete{c.stage !== "Signed" ? ": move the stage or set a next step" : ""}</div>}
                  </article>
                )) : <p className="small muted empty">None</p>}
              </section>
            ))}
          </div>
        )}
      </section>
      {b && (
        <div className="grid2">
          <section className="panel">
            <div className="panel-head"><h2>Proposals and contracts due</h2><p>Reminders also go out in the daily brief</p></div>
            <div className="tscroll">
              {b.documents.length ? (
                <table><thead><tr><th>Company</th><th>What</th><th>Due</th><th>Status</th><th className="r">Monthly</th></tr></thead>
                  <tbody>{b.documents.map(d => (
                    <tr key={d.id + d.kind} className="click" onClick={() => open(d.id)}>
                      <td><b>{d.name}</b></td><td>{DUE_LABEL[d.kind]}</td><td className="nw">{fmt(d.due)}</td>
                      <td><span className={`pill ${d.status === "overdue" ? "bad" : d.status === "today" ? "warn" : "neutral"}`}>{d.status === "overdue" ? `Overdue ${d.days}d` : d.status === "today" ? "Due today" : `In ${d.days}d`}</span></td>
                      <td className="r num">{d.valueCents ? formatDollars(d.valueCents) : "–"}</td>
                    </tr>))}</tbody></table>
              ) : <p className="small muted">Nothing due. Proposals fall due 2 days after discovery, contracts 1 day after a verbal yes.</p>}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>The cadence</h2><p>Day 0 is the day the deal entered the stage</p></div>
            <div className="ppcad">{b.cadence.map(c => (
              <div key={c.stage}><b>{c.stage}</b><ol>{c.steps.map((s, i) => <li key={i}><span className="chn" data-ch={s.channel}>Day {s.day} · {s.channel}</span> {s.action}</li>)}</ol></div>
            ))}</div>
          </section>
        </div>
      )}
    </>
  );
}
