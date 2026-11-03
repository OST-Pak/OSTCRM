/**
 * The screens, how the menu groups them, and which roles see each one.
 * Role access follows the re-platforming brief's role table; Help is open to everyone, as in the artifact.
 */
import { daysBetween } from "./dates.js";
import { DEFAULT_PLAN, type PlanConfig } from "./defaults.js";
import type { IsoDate } from "./types.js";

export type ViewId =
  | "myday" | "dashboard" | "pipeline" | "prospects" | "tasks" | "activity"
  | "brokers" | "clients" | "platforms"
  | "proof" | "import" | "help" | "access" | "audit";

export type AppRole = "owner" | "admin" | "bd_support" | "specialist" | "read_only";

export interface ViewDef { id: ViewId; group: "sell" | "partners" | "tools"; label: string; description: string }

export const VIEW_GROUPS = [
  { id: "sell", label: "Selling" },
  { id: "partners", label: "Partners and clients" },
  { id: "tools", label: "Tools" }
] as const;

export const VIEWS: readonly ViewDef[] = [
  { id: "myday", group: "sell", label: "My day", description: "Your moves, meetings and overdue items" },
  { id: "dashboard", group: "sell", label: "Dashboard", description: "Target, forecast and pace to Dec 11" },
  { id: "pipeline", group: "sell", label: "Pipeline", description: "Deals by stage, cadence and proposals" },
  { id: "prospects", group: "sell", label: "Prospects", description: "Every PEO, ASO and payroll firm, tiered" },
  { id: "tasks", group: "sell", label: "Tasks", description: "Follow-ups and reminders" },
  { id: "activity", group: "sell", label: "Activity", description: "Log calls, emails and meetings" },
  { id: "brokers", group: "partners", label: "PEO brokers", description: "Referral partners, sequences and payouts" },
  { id: "clients", group: "partners", label: "Clients", description: "Existing clients, kept out of prospecting" },
  { id: "platforms", group: "partners", label: "Platforms", description: "PEO software vendors and who uses them" },
  { id: "proof", group: "tools", label: "Proof library", description: "Case studies and one-pagers to send" },
  { id: "import", group: "tools", label: "Import", description: "Add prospects from a CSV" },
  { id: "help", group: "tools", label: "Help", description: "How the CRM works and who owns what" },
  { id: "access", group: "tools", label: "Access", description: "Who can open the CRM and what each role can do" },
  { id: "audit", group: "tools", label: "Audit log", description: "Who viewed, changed, exported or deleted what, and when" }
];

const ALL = VIEWS.map(v => v.id);
const ROLE_VIEWS: Readonly<Record<AppRole, readonly ViewId[]>> = {
  owner: ALL,
  admin: ALL,
  bd_support: ["myday", "dashboard", "pipeline", "prospects", "tasks", "activity", "brokers", "proof", "help"],
  specialist: ["myday", "pipeline", "prospects", "tasks", "activity", "proof", "help"],
  read_only: ["myday", "pipeline", "prospects", "help"]
};

export const canSeeView = (role: AppRole, v: ViewId): boolean => ROLE_VIEWS[role].includes(v);

export const viewsFor = (role: AppRole): ViewDef[] => VIEWS.filter(v => canSeeView(role, v.id));

/** The landing screen: the owner starts on the Dashboard, everyone else on My day. */
export const homeView = (role: AppRole): ViewId => (role === "owner" && canSeeView(role, "dashboard") ? "dashboard" : "myday");

/** The header line under the CRM name: where today sits in the push. */
export function pushLine(today: IsoDate, plan: PlanConfig = DEFAULT_PLAN): string {
  if (today < plan.start) return "Starts Oct 29, 2026";
  const total = daysBetween(plan.start, plan.end) + 1;
  const n = Math.min(total, Math.max(0, daysBetween(plan.start, today) + 1));
  const toDeadline = daysBetween(today, plan.deadline);
  return `Day ${n} of ${total}, ${toDeadline >= 0 ? `${toDeadline} days to the Dec 11 signing deadline` : "Dec 11 deadline passed"}`;
}
