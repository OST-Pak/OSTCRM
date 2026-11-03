import type { BoardDeal, Stage } from "@ostcrm/domain";

const day = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : undefined);

/** A deal row joined with its company name, in the shape the domain rules read. */
export function toDomainDeal(r: Record<string, unknown>): BoardDeal {
  return {
    id: String(r.company_id), name: String(r.name), stage: r.stage as Stage, ownerId: (r.owner_id as string | null) ?? null, ownerName: (r.owner_name as string | null) ?? null,
    staffSeats: Number(r.staff_seats) || 0, managerSeats: Number(r.manager_seats) || 0,
    proposalValueCents: r.expected_monthly_cents === null || r.expected_monthly_cents === undefined ? null : Number(r.expected_monthly_cents),
    stageChangedAt: day(r.stage_changed_on), createdAt: day(r.created_at), nextStep: (r.next_step as string | null) ?? undefined, nextStepDate: day(r.next_step_on),
    decisionDate: day(r.decision_on), proposalDueDate: day(r.proposal_due_on), proposalSentDate: day(r.proposal_sent_on), contractDueDate: day(r.contract_due_on),
    contractSentDate: day(r.contract_sent_on), signatureDueDate: day(r.signature_due_on), signedAt: day(r.signed_on),
    cad: r.cadence_stage ? { stage: r.cadence_stage as Stage, done: (r.cadence_done as number[]) ?? [] } : undefined
  };
}
