export interface ProposalLine { service: string; kind: "staff" | "manager" | string; seats: number; priceCents: number }

export interface ProposalDraft {
  to: string[];
  subject: string;
  intro: string;
  scope: string;
  terms: string;
  closing: string;
  pilotOn: boolean;
  pilotText: string;
  lines: ProposalLine[];
}

/** Monthly total in cents. Non-numeric seats or prices count as zero. */
export function proposalMonthlyCents(lines: readonly ProposalLine[]): number {
  return lines.reduce((s, l) => s + (Math.max(0, Math.floor(Number(l.seats))) || 0) * (Math.max(0, Math.round(Number(l.priceCents))) || 0), 0);
}

/** Replace `{{name}}` with a value; unknown or empty values leave the placeholder in place. */
export function fillVars(s: string, vars: Readonly<Record<string, string | undefined>>): string {
  return String(s || "").replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
    const v = vars[k];
    return v != null && v !== "" ? v : m;
  });
}

const okEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e);

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Checks a proposal before a version is saved. Returns the first problem, or "" when it is ready.
 * Blocks: bad addresses, a zero total, unfilled placeholders, bracketed draft text, and any
 * blocked client name (existing clients are never named in proposals).
 */
export function validateProposal(p: ProposalDraft, vars: Readonly<Record<string, string | undefined>>, blockedNames: readonly string[]): string {
  const bad = p.to.filter(e => !okEmail(e));
  if (bad.length) return `Check these addresses: ${bad.join(", ")}`;
  if (!proposalMonthlyCents(p.lines)) return "Add at least one line with seats and a price.";
  const all = [p.subject, p.intro, p.scope, p.terms, p.closing, p.pilotOn ? p.pilotText : ""].map(s => fillVars(s, vars)).join("\n");
  const left = all.match(/\{\{\w+\}\}/g);
  if (left) return `Fill these placeholders first: ${[...new Set(left)].join(", ")}`;
  const br = all.match(/\[[^\]]{2,80}\]/g);
  if (br) return `Replace the bracketed text first: ${[...new Set(br)].join(", ")}`;
  for (const name of blockedNames) {
    const rx = new RegExp(escapeRx(name.trim()).replace(/\s+/g, "\\s*"), "i");
    if (name.trim() && rx.test(all)) return `Remove the client name (${name.trim()}) first.`;
  }
  return "";
}
