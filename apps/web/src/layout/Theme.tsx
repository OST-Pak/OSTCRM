import { useEffect, useState } from "react";

const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };

// A per-viewer convenience only; the app works the same without storage.
function readTheme(): Theme {
  try { const t = localStorage.getItem("crm.theme"); return (THEMES as readonly string[]).includes(t ?? "") ? (t as Theme) : "system"; } catch { return "system"; }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
}

/** Auto, Light, Dark, in that order, as in the artifact. */
export function ThemeButton() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => { applyTheme(theme); try { localStorage.setItem("crm.theme", theme); } catch { /* storage blocked */ } }, [theme]);
  const label = LABEL[theme];
  return (
    <button type="button" className="themebtn" title="Change theme" aria-label={`Theme: ${label}. Select to switch.`}
      onClick={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!)}>
      <span className="ico" aria-hidden="true" /><span>{label}</span>
    </button>
  );
}
