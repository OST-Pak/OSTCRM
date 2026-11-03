/**
 * Synthetic demo data for end-to-end checks and screen reviews. Fictional companies and people only;
 * never a real prospect, client or price.
 */
import type pg from "pg";

type People = Record<"owner" | "admin" | "bd_support" | "specialist" | "read_only", { id: string }>;

const FIRMS = [
  ["Harbor Lane PEO", "harborlane.example", "PEO", "Ohio", "PrismHR"],
  ["Northfield Employer Services", "northfield.example", "PEO", "Texas", "isolved"],
  ["Cedar Point Payroll", "cedarpoint.example", "Payroll only", "Florida", "PrismHR"],
  ["Bluewater HR Partners", "bluewater.example", "ASO", "Georgia", "PrismHR"],
  ["Summit Ridge PEO", "summitridge.example", "PEO", "Arizona", "Worklio"],
  ["Granite State Staffing", "granitestate.example", "Staffing agency", "New Hampshire", null],
  ["Prairie Wind Employer Group", "prairiewind.example", "PEO", "Kansas", "PrismHR"],
  ["Lakeshore Workforce", "lakeshore.example", "PEO", "Michigan", "Payentry"]
] as const;

const STAGES = ["Contacted", "Replied", "Meeting booked", "Discovery done", "Proposal sent", "Verbal yes", "Target", "Signed"] as const;

export async function seedDemo(db: pg.Client, P: People): Promise<void> {
  for (let i = 0; i < FIRMS.length; i++) {
    const [name, domain, type, state, platform] = FIRMS[i]!;
    const c = (await db.query(
      `INSERT INTO companies (name, name_normalized, domain, website, type, state, platform_name, channel, owner_id)
       VALUES ($1::text, lower($1::text), $2::text, 'https://' || $2::text, $3, $4, $5, $6, $7) RETURNING id`,
      [name, domain, type, state, platform, i % 2 ? "Cold email" : "Warm network", P.owner.id])).rows[0].id;
    await db.query("INSERT INTO contacts (company_id, name, title, email, phone) VALUES ($1, $2, $3, $4, '+1 555 010 ' || $5::text)",
      [c, `Alex Example ${i + 1}`, i % 3 ? "Director of Payroll" : "CEO", `alex${i + 1}@${domain}`, String(1000 + i)]);
    const stage = STAGES[i]!;
    if (stage !== "Target") {
      await db.query(
        `INSERT INTO deals (company_id, stage, stage_changed_on, owner_id, staff_seats, manager_seats, next_step, next_step_on, decision_on)
         VALUES ($1, $2::deal_stage, current_date - $3::int, $4, $5, $6, 'Follow-up call', current_date + ($3::int % 4) - 1, CASE WHEN $2::deal_stage IN ('Proposal sent', 'Verbal yes') THEN current_date + 3 END)`,
        [c, stage, i + 1, i === 2 ? P.specialist.id : P.owner.id, (i % 3) + 1, i % 2]);
    }
    await db.query("INSERT INTO activities (company_id, type, direction, outcome, occurred_on, summary) VALUES ($1, 'Call', 'Outbound', 'Neutral', current_date - $2::int, 'Intro call')", [c, i]);
  }
  for (let i = 0; i < 60; i++) {
    await db.query("INSERT INTO companies (name, name_normalized, domain, type, state) VALUES ($1::text, lower($1::text), $2, 'PEO', 'Texas')",
      [`Example Firm ${String(i + 1).padStart(2, "0")}`, `firm${i + 1}.example`]);
  }
}
