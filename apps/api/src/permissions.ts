/**
 * Named actions checked by middleware on every route. The UI hides what a role cannot do,
 * but that is cosmetic; this table is the control. Row-level security in the database is the second layer.
 */
export type Role = "owner" | "admin" | "bd_support" | "specialist" | "read_only";

export const ACTIONS = [
  "pipeline.read",     // companies, deals, contacts, activities, tasks
  "proposal.read",
  "deal.edit",         // companies, contacts, deals (Specialists: assigned deals only, enforced in the database)
  "deal.archive",
  "activity.log",
  "task.manage",
  "proposal.edit",
  "proposal.markSent", // replaces the brief's proposal.send: proposals are sent outside the CRM
  "referral.edit",
  "export.csv",        // bulk export: logged, and alerts the owner
  "config.edit",
  "user.manage",
  "role.change",       // owner only, reason required
  "audit.read",
  "record.purge",      // owner only, records archived 90+ days
  "ai.settings",       // owner only
  "error.report"       // any signed-in person can report a client error
] as const;
export type Action = (typeof ACTIONS)[number];

const ALL: readonly Action[] = ACTIONS;
const WORK: readonly Action[] = ["pipeline.read", "proposal.read", "deal.edit", "deal.archive", "activity.log", "task.manage", "proposal.edit", "proposal.markSent", "referral.edit", "error.report"];

export const ROLE_ACTIONS: Readonly<Record<Role, ReadonlySet<Action>>> = {
  owner: new Set(ALL),
  admin: new Set(ALL.filter(a => !["role.change", "record.purge", "ai.settings"].includes(a))),
  bd_support: new Set(WORK),
  specialist: new Set<Action>(["pipeline.read", "proposal.read", "deal.edit", "activity.log", "task.manage", "error.report"]),
  read_only: new Set<Action>(["pipeline.read", "error.report"])
};

export const can = (role: Role, action: Action): boolean => ROLE_ACTIONS[role].has(action);
