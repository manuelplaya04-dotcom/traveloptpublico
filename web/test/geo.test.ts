import { describe, expect, it } from "vitest";
import { estimateTrip, fmtTrip, hasCoords, haversineKm } from "../lib/geo";

describe("distancias estimadas", () => {
  const timesSquare = { lat: 40.758, lon: -73.9855 };
  const moma = { lat: 40.7614, lon: -73.9776 };
  const statue = { lat: 40.6892, lon: -74.0445 };

  it("haversine en km (Times Square → Estatua ≈ 9 km)", () => {
    expect(haversineKm(timesSquare, statue)).toBeGreaterThan(8.5);
    expect(haversineKm(timesSquare, statue)).toBeLessThan(9.5);
    expect(haversineKm(moma, moma)).toBe(0);
  });
  it("cerca a pie, lejos en auto, con factor de calles", () => {
    expect(estimateTrip(timesSquare, moma)).toMatchObject({ mode: "a pie" });
    const far = estimateTrip(timesSquare, statue);
    expect(far.mode).toBe("en auto");
    expect(far.km).toBeCloseTo(haversineKm(timesSquare, statue) * 1.3, 0);
    expect(fmtTrip(far)).toMatch(/km · ~\d+ min en auto/);
  });
  it("sin coordenadas no hay distancia (nada inventado)", () => {
    expect(hasCoords({ lat: null, lon: 2 })).toBe(false);
    expect(hasCoords({})).toBe(false);
    expect(hasCoords(moma)).toBe(true);
  });
});
