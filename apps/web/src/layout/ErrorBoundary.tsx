import { Component, type ReactNode } from "react";
import type { Api } from "../api/client.js";

/** A screen that crashes shows a plain message and reports the error; the rest of the app keeps working. */
export class ErrorBoundary extends Component<{ api: Api; children: ReactNode; resetKey?: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error) { this.props.api.reportError(error.message, { stack: error.stack }); }
  override componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel" role="alert">
        <h2>This screen failed to load</h2>
        <p>The error was recorded. Reload the page to try again. If it keeps happening, tell Saad.</p>
      </div>
    );
  }
}
