import { describe, expect, it } from "vitest";
import { VIEWS, canSeeView, drawerAbilities, homeView, pushLine, viewsFor } from "../src/index.js";

describe("screens by role", () => {
  it("owner and admin see all 14 screens", () => {
    expect(viewsFor("owner")).toHaveLength(14);
    expect(viewsFor("admin")).toHaveLength(VIEWS.length);
  });

  it("each role sees what the brief's role table gives it, plus Help", () => {
    expect(viewsFor("bd_support").map(v => v.id)).toEqual(["myday", "dashboard", "pipeline", "prospects", "tasks", "activity", "brokers", "proof", "help"]);
    expect(viewsFor("specialist").map(v => v.id)).toEqual(["myday", "pipeline", "prospects", "tasks", "activity", "proof", "help"]);
    expect(viewsFor("read_only").map(v => v.id)).toEqual(["myday", "pipeline", "prospects", "help"]);
  });

  it("access, audit, import, clients and platforms are owner and admin only", () => {
    for (const v of ["access", "audit", "import", "clients", "platforms"] as const) {
      expect(canSeeView("bd_support", v)).toBe(false);
      expect(canSeeView("admin", v)).toBe(true);
    }
  });

  it("the owner lands on the Dashboard; everyone else on My day", () => {
    expect(homeView("owner")).toBe("dashboard");
    expect(homeView("admin")).toBe("myday");
    expect(homeView("read_only")).toBe("myday");
  });
});

describe("push line", () => {
  it("counts the day and the days to the deadline", () => {
    expect(pushLine("2026-11-02")).toBe("Day 5 of 60, 39 days to the Dec 11 signing deadline");
    expect(pushLine("2026-10-29")).toBe("Day 1 of 60, 43 days to the Dec 11 signing deadline");
    expect(pushLine("2026-12-11")).toBe("Day 44 of 60, 0 days to the Dec 11 signing deadline");
  });

  it("before the start, after the deadline, and after the end", () => {
    expect(pushLine("2026-10-28")).toBe("Starts Oct 29, 2026");
    expect(pushLine("2026-12-12")).toBe("Day 45 of 60, Dec 11 deadline passed");
    expect(pushLine("2027-01-15")).toBe("Day 60 of 60, Dec 11 deadline passed");
  });
});

describe("drawerAbilities", () => {
  it("matches the API: Specialists work their own deals, Read only changes nothing", () => {
    expect(drawerAbilities("bd_support", false)).toEqual({ editCompany: true, editDeal: true, logActivity: true, manageTasks: true, editContacts: true, addProspect: true, archive: true });
    expect(drawerAbilities("specialist", false).editDeal).toBe(false);
    expect(drawerAbilities("specialist", true)).toMatchObject({ editDeal: true, editCompany: false, editContacts: false, logActivity: true });
    expect(Object.values(drawerAbilities("read_only", true)).some(Boolean)).toBe(false);
  });
});
