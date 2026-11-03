/**
 * The sales pipeline board and the cadence tick, ported from the artifact's `renderPipeline`, `docDue` and `cadDone`.
 */
import { cadenceFor, documentDue, type CadenceItem, type DocumentKind } from "./cadence.js";
import { addDays, daysBetween } from "./dates.js";
import { DEFAULT_CADENCE, DEFAULT_DOCUMENT_SLA, PIPELINE_STAGES, type CadenceStep } from "./defaults.js";
import { monthlyValueCents } from "./money.js";
import { stageSince } from "./stages.js";
import type { Company, IsoDate, Stage } from "./types.js";

export interface BoardDeal extends Company { ownerId?: string | null; ownerName?: string | null; proposalValueCents?: number | null }

export interface BoardCard {
  id: string; name: string; ownerName: string | null; daysInStage: number; daysSinceTouch: number | null; valueCents: number;
  next: (CadenceItem & { total: number }) | null; overdue: boolean;
}
export interface BoardColumn { stage: Stage; count: number; valueCents: number; cards: BoardCard[] }
export interface Board { columns: BoardColumn[]; open: number; overdue: number }

/** Columns for every pipeline stage; cards sorted by when their next cadence step is due. Value is seats at founding prices. */
export function pipelineBoard(deals: readonly BoardDeal[], lastTouch: ReadonlyMap<string, IsoDate>, today: IsoDate,
  cadence: Readonly<Partial<Record<Stage, readonly CadenceStep[]>>> = DEFAULT_CADENCE): Board {
  let overdue = 0, open = 0;
  const columns = PIPELINE_STAGES.map(stage => {
    const cards = deals.filter(d => d.stage === stage).map(d => {
      const plan = cadenceFor(d, today, cadence);
      const lt = lastTouch.get(d.id);
      const od = !!plan.next && plan.next.due < today;
      if (od) overdue++;
      return {
        id: d.id, name: d.name, ownerName: d.ownerName ?? null, daysInStage: daysBetween(stageSince(d, today), today),
        daysSinceTouch: lt ? daysBetween(lt, today) : null, valueCents: monthlyValueCents(d),
        next: plan.next ? { ...plan.next, total: plan.total } : null, overdue: od
      };
    }).sort((a, b) => String(a.next?.due ?? "9").localeCompare(String(b.next?.due ?? "9")));
    open += cards.length;
    return { stage, count: cards.length, valueCents: cards.reduce((s, c) => s + c.valueCents, 0), cards };
  });
  return { columns, open, overdue };
}

export interface DocumentRow { id: string; name: string; kind: DocumentKind; due: IsoDate; status: "overdue" | "today" | "upcoming"; days: number; valueCents: number }

/** Proposals, contracts, decisions and signatures due, soonest first. Value is seats, else the proposal value. */
export function documentsDue(deals: readonly BoardDeal[], today: IsoDate, sla = DEFAULT_DOCUMENT_SLA): DocumentRow[] {
  return deals.filter(d => ["Discovery done", "Proposal sent", "Verbal yes"].includes(d.stage))
    .flatMap(d => {
      const x = documentDue(d, today, sla);
      if (!x) return [];
      const status = x.due < today ? "overdue" : x.due === today ? "today" : "upcoming";
      return [{ id: d.id, name: d.name, kind: x.kind, due: x.due, status, days: Math.abs(daysBetween(today, x.due)),
        valueCents: monthlyValueCents(d) || d.proposalValueCents || 0 } as DocumentRow];
    })
    .sort((a, b) => a.due.localeCompare(b.due));
}

/** The activity type a cadence channel logs as. */
export const CADENCE_ACTIVITY: Readonly<Record<string, string>> = { Email: "Email", Call: "Call", LinkedIn: "LinkedIn", Task: "Note", Proposal: "Note" };

export interface CadenceTick { error: string; done?: number[]; activity?: { type: string; summary: string } }

/**
 * Tick a cadence step off. Ticks are kept per stage, so ticks from an earlier stage are dropped.
 * A Proposal step is ticked by sending the proposal, not by hand.
 */
export function cadenceTick(d: Company, index: number, today: IsoDate, cadence: Readonly<Partial<Record<Stage, readonly CadenceStep[]>>> = DEFAULT_CADENCE): CadenceTick {
  const plan = cadenceFor(d, today, cadence);
  const step = plan.steps[index];
  if (!step) return { error: "That cadence step doesn't exist for this stage." };
  if (step.channel === "Proposal") return { error: "This step is done by sending the proposal." };
  const prev = d.cad && d.cad.stage === d.stage ? d.cad.done : [];
  return { error: "", done: [...new Set([...prev, index])].sort((a, b) => a - b), activity: { type: CADENCE_ACTIVITY[step.channel] ?? "Note", summary: `Cadence step ${index + 1}: ${step.action}` } };
}

/** Contract sent: signature falls due `signatureDays` later. */
export const signatureDueAfter = (sentOn: IsoDate, sla = DEFAULT_DOCUMENT_SLA): IsoDate => addDays(sentOn, sla.signatureDays);
