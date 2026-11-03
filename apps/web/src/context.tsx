import { createContext, useContext } from "react";
import type { AppRole } from "@ostcrm/domain";
import type { Api } from "./api/client.js";

export interface Me { id: string; role: AppRole; name: string }

export interface AppContext { api: Api; me: Me; signOut(): void }

export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside the app");
  return c;
}

/** Today as YYYY-MM-DD in the viewer's time zone. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
