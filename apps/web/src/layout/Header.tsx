import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { VIEW_GROUPS, pushLine, viewsFor, type ViewId } from "@ostcrm/domain";
import { todayLocal, useApp } from "../context.js";
import { ThemeButton } from "./Theme.js";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", bd_support: "BD support", specialist: "Specialist", read_only: "Read only" } as const;

/** Header with the mega menu, as in the artifact: three groups, each item with a one-line description. */
export function Header({ current }: { current: ViewId | null }) {
  const { me, signOut } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const views = viewsFor(me.role);
  const cur = views.find(v => v.id === current);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("#megap") && !t.closest(".mega-t")) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const g = open;
      setOpen(null);
      document.querySelector<HTMLButtonElement>(`.mega-t[data-g="${g}"]`)?.focus();
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    panel.current?.style.setProperty("--hdr-h", `${header.current?.getBoundingClientRect().height ?? 60}px`);
    setTimeout(() => panel.current?.querySelector<HTMLAnchorElement>(`.mg[data-g="${open}"] a`)?.focus({ preventScroll: true }), 20);
    return () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => { setOpen(null); }, [current]);

  const groups = VIEW_GROUPS.filter(g => views.some(v => v.group === g.id));
  return (
    <>
      <header className="top" ref={header}>
        <div className="wrap">
          <div className="brand"><b>Oak Street BD CRM</b><span>{pushLine(todayLocal())}</span></div>
          <nav className="mega" aria-label="Views">
            {groups.map(g => (
              <button key={g.id} type="button" className={`mega-t${cur?.group === g.id ? " cur" : ""}`} data-g={g.id}
                aria-expanded={open === g.id} aria-controls="megap"
                onClick={e => { e.stopPropagation(); setOpen(open === g.id ? null : g.id); }}>{g.label}</button>
            ))}
            <span className="mega-cur" aria-live="polite">{cur?.label ?? ""}</span>
          </nav>
          <div className="me">
            <span><span className="me-l">Signed in as </span><b>{me.name}</b> <span className="small muted">{ROLE_LABEL[me.role]}</span></span>
            <ThemeButton />
            {import.meta.env.MODE === "localpreview" && <button type="button" className="linkbtn" onClick={signOut}>Switch person</button>}
          </div>
        </div>
      </header>
      <div className="megap" id="megap" ref={panel} hidden={!open} data-g={open ?? undefined}>
        <div className="wrap megap-in">
          {groups.map(g => (
            <section key={g.id} className={`mg${open === g.id ? " hot" : ""}`} data-g={g.id}>
              <h3>{g.label}</h3>
              {views.filter(v => v.group === g.id).map(v => (
                <Link key={v.id} to="/$view" params={{ view: v.id }} className="mg-i" aria-current={v.id === current ? "page" : undefined} onClick={() => setOpen(null)}>
                  <span className="mg-t"><b>{v.label}</b></span>
                  <span className="mg-d">{v.description}</span>
                </Link>
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
