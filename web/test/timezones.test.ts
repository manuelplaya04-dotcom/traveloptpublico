import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dayTags, groupByStay, timeline } from "../lib/checkout";
import { CITIES } from "../lib/cities";
import { CITY_FACTS, factsFor } from "../lib/cityFacts";
import { dayOffset, fmtDayOffset, fmtDuration } from "../lib/format";
import { buildIcs } from "../lib/ics";
import type { FlightOffer, ItineraryPayload } from "../lib/types";

const fl = (id: string, dep: string, arr: string, extra: Partial<FlightOffer> = {}) =>
  ({ id, depart_at: dep, arrive_at: arr, ...extra }) as FlightOffer;
const trip = (stays: { city: string; check_in: string; check_out: string }[]) =>
  ({ stays: stays.map((s) => ({ ...s, activities: [] })) }) as unknown as ItineraryPayload;

describe("cruce de fechas y husos", () => {
  it("días de calendario entre salida y llegada", () => {
    expect(dayOffset("2027-07-10T08:00", "2027-07-10T16:20")).toBe(0);
    expect(dayOffset("2027-07-08T22:30", "2027-07-09T07:10")).toBe(1);
    expect(dayOffset("2027-07-10T22:00", "2027-07-12T08:30")).toBe(2); // Los Ángeles → Sídney
    expect(dayOffset("2027-07-10T23:50", "2027-07-09T06:00")).toBe(-1); // línea de cambio de fecha hacia el este
    expect(dayOffset("basura", "2027-07-09T06:00")).toBe(0);
    expect([fmtDayOffset(0), fmtDayOffset(2), fmtDayOffset(-1)]).toEqual(["", "+2", "−1"]);
  });

  it("duración legible, y vacía si no se conoce", () => {
    expect(fmtDuration(320)).toBe("5 h 20 min");
    expect(fmtDuration(600)).toBe("10 h");
    expect(fmtDuration(45)).toBe("45 min");
    expect([fmtDuration(null), fmtDuration(undefined), fmtDuration(0), fmtDuration(-5)]).toEqual(["", "", "", ""]);
  });

  it("hacia el oeste: llegar 'antes' en hora local no altera el calendario", () => {
    const it = trip([{ city: "LAX", check_in: "2027-07-10", check_out: "2027-07-12" }]);
    const days = timeline(it, [fl("A", "2027-07-10T17:00", "2027-07-10T11:00")], (c) => c);
    expect(days[0]).toMatchObject({ index: 1, date: "2027-07-10" });
    expect(days[0].flights.map((f) => f.id)).toEqual(["A"]);
    expect(days[0].sleep).toEqual({ city: "LAX", lodging: "LAX" });
  });

  it("salto de un día entero (Los Ángeles → Sídney): el día intermedio queda en vuelo y numerado", () => {
    const it = trip([{ city: "SYD", check_in: "2027-07-12", check_out: "2027-07-14" }]);
    const days = timeline(it, [fl("A", "2027-07-10T22:00", "2027-07-12T08:30")], (c) => c);
    expect(days.map((d) => [d.index, d.date])).toEqual([[1, "2027-07-10"], [2, "2027-07-11"], [3, "2027-07-12"], [4, "2027-07-13"], [5, "2027-07-14"]]);
    expect(days[0].sleep).toBe("vuelo");
    expect(days[2].tags.map((t) => t.kind)).toEqual(["drop_off"]);
    expect(() => groupByStay(days, it.stays)).not.toThrow();
  });

  it("llegada con fecha anterior a la salida: el viaje sigue empezando el día que sale, sin días fantasma", () => {
    const it = trip([{ city: "PPT", check_in: "2027-07-09", check_out: "2027-07-12" }]);
    const days = timeline(it, [fl("A", "2027-07-10T23:50", "2027-07-09T06:00")], (c) => c);
    expect(days[0]).toMatchObject({ index: 1, date: "2027-07-10" });
    expect(days.flatMap((d) => d.flights.map((f) => f.id))).toEqual(["A"]);
    expect(dayTags("2027-07-09", [fl("A", "2027-07-10T23:50", "2027-07-09T19:00")], it.stays, (c) => c)).toEqual([]);
  });
});

describe("calendario .ics", () => {
  const payload = (f: Partial<FlightOffer>) => ({
    skeleton_id: "x", stays: [],
    flights: [{ leg: 0, offer: { carrier: "AA", origin: "NRT", destination: "LAX", stops: 0, depart_at: "2027-07-10T17:00:00", arrive_at: "2027-07-10T11:00:00", ...f } }],
  }) as unknown as ItineraryPayload;

  it("con UTC el evento dura lo que el vuelo aunque llegue 'antes' en hora local", () => {
    const ics = buildIcs(payload({ depart_utc: "2027-07-10T08:00:00Z", arrive_utc: "2027-07-10T18:00:00Z" }), (c) => c);
    expect(ics).toContain("DTSTART:20270710T080000Z");
    expect(ics).toContain("DTEND:20270710T180000Z");
  });

  it("sin UTC usa la hora local y no rompe con un dato inválido", () => {
    expect(buildIcs(payload({}), (c) => c)).toContain("DTSTART:20270710T170000");
    expect(buildIcs(payload({ depart_utc: "basura", arrive_utc: null }), (c) => c)).toContain("DTSTART:20270710T170000");
  });

  it("el texto del evento no lleva emojis", () => {
    expect(buildIcs(payload({}), (c) => c)).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("interfaz sin emojis", () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

  it("ninguno en el código (se renderizan distinto en cada sistema)", () => {
    const bad = ["app", "components", "lib", "hooks"].flatMap(walk).filter((f) => /\.tsx?$/.test(f)).flatMap((f) =>
      readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l) && /[\p{Extended_Pictographic}]/u.test(l.replace(/[©®™]/g, "")))
        .map((l) => `${f}: ${l.trim().slice(0, 60)}`));
    expect(bad).toEqual([]);
  });
});

describe("datos curiosos de la pantalla de espera", () => {
  it("todas las ciudades del catálogo tienen, y sin datos no se muestra nada", () => {
    for (const c of CITIES) expect(CITY_FACTS[c.code]?.length, c.code).toBeGreaterThan(0);
    expect(factsFor(["XXX"])).toEqual([]);
  });
});
