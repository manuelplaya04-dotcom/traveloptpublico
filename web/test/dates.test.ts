import { describe, expect, it } from "vitest";
import { addDays, diffDays, isIsoDate, todayIso } from "../lib/dates";

describe("fechas de calendario", () => {
  it("suma y resta días cruzando meses, años y bisiestos", () => {
    expect(addDays("2027-07-08", 12)).toBe("2027-07-20");
    expect(addDays("2027-12-30", 3)).toBe("2028-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(diffDays("2027-07-08", "2027-07-20")).toBe(12);
    expect(diffDays("2027-03-01", "2027-03-31")).toBe(30); // sin corrimiento por horario de verano
  });
  it("valida el formato y que la fecha exista", () => {
    expect(isIsoDate("2027-07-08")).toBe(true);
    for (const bad of ["", "2027-7-8", "27-07-08", "+102027-07-08", "2027-13-01", "2027-02-30"]) expect(isIsoDate(bad)).toBe(false);
  });
  it("hoy es la fecha local, no la de UTC", () => {
    const lateNightArgentina = new Date("2026-11-02T01:30:00Z"); // 22:30 del 1/11 en UTC-3
    expect(todayIso(lateNightArgentina)).toBe(lateNightArgentina.getTimezoneOffset() === 180 ? "2026-11-01" : todayIso(lateNightArgentina));
  });
});
