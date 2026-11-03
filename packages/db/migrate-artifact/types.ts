/** The file written by the artifact's owner-only "Export all data" button (formatVersion 1). */
export interface ArtifactExport {
  format: "oak-street-crm-export";
  formatVersion: 1;
  exportedAt: string;
  exportedBy?: string;
  collections: Record<string, ArtifactRecord[] | undefined>;
  counts?: Record<string, number>;
  warnings?: string[];
}

/** Every exported record carries its artifact id; the rest is whatever the artifact stored. */
export type ArtifactRecord = { id: string } & Record<string, unknown>;

/**
 * Who each person is in Entra ID. Engineer B fills this in from the tenant before each run:
 * the artifact only knows self-chosen team names and opaque artifact user ids.
 */
export interface PersonMapping {
  /** The team name the person picked in the artifact (TEAM list), e.g. "Awais". */
  teamName: string;
  email: string;
  displayName: string;
  entraOid?: string;
  /** Role in the new system. Defaults to the artifact access role, else read_only. */
  role?: "owner" | "admin" | "bd_support" | "specialist" | "read_only";
}

export type Row = Record<string, unknown>;

export interface Rejection { collection: string; id: string; reason: string }
export interface Note { collection: string; id: string; note: string }

export interface Transformed {
  /** Rows per target table, in an order that satisfies foreign keys. */
  tables: [table: string, rows: Row[]][];
  report: ReconciliationReport;
}

export interface ReconciliationReport {
  exportedAt: string;
  in: Record<string, number>;
  out: Record<string, number>;
  rejected: Rejection[];
  /** Records loaded with a change worth a human look (duplicate domain linked, email cleared, owner unknown). */
  adjusted: Note[];
  /** Collections or settings not migrated, and why. */
  notMigrated: { what: string; why: string }[];
  dealsPerStage: Record<string, number>;
  /** "Person | YYYY-MM-DD (Monday)" -> touch count. */
  activitiesPerPersonPerWeek: Record<string, number>;
  proposals: { total: number; sent: number; versions: number; monthlyCentsSent: number };
  clients: number;
}
