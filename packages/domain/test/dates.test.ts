import { describe, expect, it } from "vitest";
import { addDays, datePart, daysBetween, toUtc, weekStart, weekday, workdays } from "../src/index.js";

describe("dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-12-11", -21)).toBe("2026-11-20");
  });

  it("counts days in both directions", () => {
    expect(daysBetween("2026-11-01", "2026-11-08")).toBe(7);
    expect(daysBetween("2026-11-08", "2026-11-01")).toBe(-7);
  });

  it("does not shift with daylight saving (US clocks change Nov 1, 2026)", () => {
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => toUtc("2026-11-2")).toThrow();
    expect(() => toUtc("2026-02-30")).toThrow();
  });

  it("weeks start on Monday", () => {
    expect(weekday("2026-11-02")).toBe(0);
    expect(weekday("2026-11-08")).toBe(6);
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
  });

  it("working days skip weekends and off days", () => {
    expect(workdays("2026-11-02", "2026-11-08")).toBe(5);
    expect(workdays("2026-11-23", "2026-11-29", new Set(["2026-11-26", "2026-11-27"]))).toBe(3);
    expect(workdays("2026-11-09", "2026-11-02")).toBe(0);
  });

  it("takes the date part of a timestamp", () => {
    expect(datePart("2026-10-29T23:00:00.000Z")).toBe("2026-10-29");
    expect(datePart(undefined)).toBe("");
  });
});
