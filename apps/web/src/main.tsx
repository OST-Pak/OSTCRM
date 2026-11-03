import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createApi, ApiError } from "./api/client.js";
import { createAuth } from "./auth/token.js";
import { App } from "./App.js";
import type { Me } from "./context.js";
import { applyTheme } from "./layout/Theme.js";
import "./styles/crm.css";
import "./styles/app.css";

const root = createRoot(document.getElementById("root")!);

function Message({ title, body }: { title: string; body: string }) {
  return <main className="wrap"><section className="panel" role="alert" style={{ marginTop: 24 }}><h2>{title}</h2><p>{body}</p></section></main>;
}

async function start() {
  try { const t = localStorage.getItem("crm.theme"); if (t === "light" || t === "dark") applyTheme(t); } catch { /* storage blocked */ }
  let auth;
  try { auth = await createAuth(); } catch (e) {
    root.render(<Message title="Sign-in is not available" body={`${(e as Error).message}. Tell Saad.`} />);
    return;
  }
  const api = createApi(auth);
  window.addEventListener("error", e => api.reportError(e.message, { stack: (e.error as Error | undefined)?.stack }));
  window.addEventListener("unhandledrejection", e => api.reportError(String((e.reason as Error)?.message ?? e.reason), { stack: (e.reason as Error)?.stack }));
  let me: Me;
  try { me = await api.get<Me>("/v1/me"); } catch (e) {
    const err = e as ApiError;
    if (err.status === 403) root.render(<Message title="You do not have access to the CRM" body="Ask Saad to add you." />);
    else if (err.status === 0) root.render(<Message title="Can't reach the CRM" body="Check your connection and reload the page." />);
    else root.render(<Message title="The CRM could not start" body={`The error was recorded (reference ${err.requestId ?? "unknown"}). Reload the page.`} />);
    return;
  }
  root.render(<StrictMode><App ctx={{ api, me, signOut: () => void auth!.signOut() }} /></StrictMode>);
}

void start();
