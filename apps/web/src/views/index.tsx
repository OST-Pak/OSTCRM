import type { ComponentType } from "react";
import { VIEWS, type ViewId } from "@ostcrm/domain";
import { Prospects } from "./Prospects.js";

/** Screens are added here as they are ported. Anything not listed shows a "not ported yet" panel. */
export const SCREENS: Partial<Record<ViewId, ComponentType>> = { prospects: Prospects };

export function NotPorted({ view }: { view: ViewId }) {
  const v = VIEWS.find(x => x.id === view)!;
  return (
    <section className="panel">
      <h2>{v.label}</h2>
      <p className="muted">This screen has not been ported to the hosted CRM yet. Use the current CRM for it until it is.</p>
    </section>
  );
}
