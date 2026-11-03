import { addDays } from "./dates.js";
import { DEFAULT_CADENCE, DEFAULT_DOCUMENT_SLA, type CadenceStep, type DocumentSla } from "./defaults.js";
import { stageSince } from "./stages.js";
import type { Company, IsoDate, Stage } from "./types.js";

export interface CadenceItem extends CadenceStep { index: number; due: IsoDate; done: boolean }
export interface CadencePlan { steps: CadenceItem[]; next: CadenceItem | null; doneCount: number; total: number }

/**
 * The cadence for a deal's current stage. Each step is due `day` days after the stage started.
 * Ticks recorded for an earlier stage do not carry over.
 */
export function cadenceFor(
  c: Company,
  today: IsoDate,
  cadence: Readonly<Partial<Record<Stage, readonly CadenceStep[]>>> = DEFAULT_CADENCE
): CadencePlan {
  const steps = cadence[c.stage] ?? [];
  const base = stageSince(c, today);
  const done = c.cad && c.cad.stage === c.stage && Array.isArray(c.cad.done) ? new Set(c.cad.done) : new Set<number>();
  const list = steps.map((s, index) => ({ ...s, index, due: addDays(base, s.day), done: done.has(index) }));
  return { steps: list, next: list.find(s => !s.done) ?? null, doneCount: list.filter(s => s.done).length, total: list.length };
}

/** Steps that are not done and due before today. */
export function overdueSteps(plan: CadencePlan, today: IsoDate): CadenceItem[] {
  return plan.steps.filter(s => !s.done && s.due < today);
}

export type DocumentKind = "Proposal" | "Contract" | "Decision" | "Signature";
export interface DocumentDue { kind: DocumentKind; due: IsoDate }

/**
 * What document or decision is due next, and when. A date set by hand on the deal wins.
 * Discovery done: proposal due 2 days after. Verbal yes: contract due 1 day after; once the
 * contract is sent, signature due 3 days after it. Proposal sent: decision due 5 days after sending.
 */
export function documentDue(c: Company, today: IsoDate, sla: DocumentSla = DEFAULT_DOCUMENT_SLA): DocumentDue | null {
  const since = stageSince(c, today);
  if (c.stage === "Discovery done") return { kind: "Proposal", due: c.proposalDueDate || addDays(since, sla.proposalDays) };
  if (c.stage === "Verbal yes" && !c.contractSentDate) return { kind: "Contract", due: c.contractDueDate || addDays(since, sla.contractDays) };
  if (c.stage === "Verbal yes" && c.contractSentDate) return { kind: "Signature", due: c.signatureDueDate || addDays(c.contractSentDate, sla.signatureDays) };
  if (c.stage === "Proposal sent") return { kind: "Decision", due: c.decisionDate || addDays(c.proposalSentDate || since, sla.decisionDays) };
  return null;
}
