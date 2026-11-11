import { describe, expect, it } from "vitest";
import { totals, type Cart } from "../lib/cart";
import { dayTags, groupByStay, hourOf, rubros, splitPerPax, timeline } from "../lib/checkout";
import type { Leg } from "../lib/flights";
import type { FlightOffer, ItineraryPayload } from "../lib/types";

describe("checkout", () => {
  it("reparte por persona como el motor (golden: 4,016.73 ×2 y 4,016.72 ×3)", () => {
    expect(splitPerPax(2008362, 5)).toEqual([401673, 401673, 401672, 401672, 401672]);
    expect(splitPerPax(2008362, 5).reduce((a, b) => a + b)).toBe(2008362);
  });

  it("separa interconexiones de ida y vuelta sin perder un centavo", () => {
    const pick = (id: string, costMinor: number) => ({ id, label: id, category: "vuelos" as const, costMinor });
    const cart: Cart = {
      base: { vuelos: 1048500, alojamiento: 355662, actividades: 508000, transporte: 96200 },
      optimal: { "flight:0": pick("F02", 465000), "flight:1": pick("F13", 88500), "flight:2": pick("F21", 495000) },
      selected: {},
    };
    const legs = [{ index: 0, from: "HOME", to: "ORL" }, { index: 1, from: "ORL", to: "NYC" }, { index: 2, from: "NYC", to: "HOME" }] as Leg[];
    const r = rubros(totals(cart), legs, (l) => cart.optimal[`flight:${l.index}`].costMinor);
    expect(Object.fromEntries(r.map((x) => [x.key, x.minor]))).toEqual({
      vuelos: 960000, interconexiones: 88500, alojamiento: 355662, actividades: 508000, transporte: 96200,
    });
    expect(r.reduce((a, x) => a + x.minor, 0)).toBe(2008362);
  });

  it("arma el calendario: vuelo nocturno, dónde duerme cada noche y actividades", () => {
    const f = (id: string, dep: string, arr: string) => ({ id, depart_at: dep, arrive_at: arr }) as FlightOffer;
    const it = {
      stays: [
        { city: "ORL", check_in: "2027-07-08", check_out: "2027-07-10", activities: [{ date: "2027-07-09", name: "EPIC" }] },
        { city: "NYC", check_in: "2027-07-10", check_out: "2027-07-11", activities: [] },
      ],
    } as unknown as ItineraryPayload;
    const days = timeline(it, [f("A", "2027-07-07T22:30", "2027-07-08T07:10"), f("B", "2027-07-10T09:00", "2027-07-10T11:00"),
      f("C", "2027-07-11T18:00", "2027-07-12T08:00")], (c) => `hotel ${c}`);
    expect(days.map((d) => [d.date, d.flights.map((x) => x.id).join(), d.sleep === null || typeof d.sleep === "string" ? d.sleep : d.sleep.lodging,
      d.activities.map((a) => a.name).join()])).toEqual([
      ["2027-07-07", "A", "vuelo", ""],
      ["2027-07-08", "", "hotel ORL", ""],
      ["2027-07-09", "", "hotel ORL", "EPIC"],
      ["2027-07-10", "B", "hotel NYC", ""],
      ["2027-07-11", "C", "vuelo", ""],
      ["2027-07-12", "", null, ""],
    ]);
  });

  const fl = (id: string, dep: string, arr: string) => ({ id, depart_at: dep, arrive_at: arr }) as FlightOffer;
  const trip = (stays: { city: string; check_in: string; check_out: string }[]) =>
    ({ stays: stays.map((s) => ({ ...s, activities: [] })) }) as unknown as ItineraryPayload;

  it("numera desde el Día 1 y agrupa por destino con check-in, check-out y noches", () => {
    const it = trip([{ city: "ORL", check_in: "2027-07-08", check_out: "2027-07-12" }, { city: "NYC", check_in: "2027-07-12", check_out: "2027-07-14" }]);
    const days = timeline(it, [fl("A", "2027-07-07T22:30", "2027-07-08T07:10"), fl("B", "2027-07-12T09:00", "2027-07-12T11:30"),
      fl("C", "2027-07-14T21:00", "2027-07-15T09:00")], (c) => c);
    expect(days.map((d) => d.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const g = groupByStay(days, it.stays);
    expect(g.map((x) => [x.city, x.nights, x.days.map((d) => d.index).join()])).toEqual([
      [null, undefined, "1"], ["ORL", 4, "2,3,4,5"], ["NYC", 2, "6,7,8"], [null, undefined, "9"],
    ]);
    expect(g[1]).toMatchObject({ checkIn: "2027-07-08", checkOut: "2027-07-12" });
    // el día que deja Nueva York (duerme en el avión) sigue en el grupo de Nueva York
    expect(g[2].days.at(-1)).toMatchObject({ date: "2027-07-14", sleep: "vuelo" });
  });

  it("vuelos: llegada tardía = día de traslado; temprana = drop-off; salida tarde = último día aprovechable", () => {
    const stays = [{ city: "NYC", check_in: "2027-07-10", check_out: "2027-07-14" }];
    const name = (c: string) => (c === "NYC" ? "Nueva York" : c);
    expect(dayTags("2027-07-10", [fl("X", "2027-07-10T14:00", "2027-07-10T18:00")], stays, name).map((t) => t.kind)).toEqual(["transfer"]);
    expect(dayTags("2027-07-10", [fl("X", "2027-07-10T14:00", "2027-07-10T17:59")], stays, name)).toEqual([]);
    const early = dayTags("2027-07-10", [fl("X", "2027-07-09T23:00", "2027-07-10T08:00")], stays, name);
    expect(early).toMatchObject([{ kind: "drop_off" }]);
    expect(early[0].text).toContain("08:00");
    expect(early[0].text).toContain("15:00");
    expect(dayTags("2027-07-10", [fl("X", "2027-07-10T10:00", "2027-07-10T13:30")], stays, name)).toEqual([]); // poco margen
    const late = dayTags("2027-07-14", [fl("Y", "2027-07-14T19:00", "2027-07-15T07:00")], stays, name);
    expect(late).toMatchObject([{ kind: "last_usable", text: "Último día aprovechable en Nueva York: el vuelo sale a las 19:00" }]);
    expect(dayTags("2027-07-14", [fl("Y", "2027-07-14T18:59", "2027-07-15T07:00")], stays, name)).toEqual([]);
    // una llegada que no abre estadía (vuelta a casa) no lleva etiqueta
    expect(dayTags("2027-07-15", [fl("Y", "2027-07-14T19:00", "2027-07-15T07:00")], stays, name)).toEqual([]);
  });

  it("zero-crash: horarios o fechas corruptos no rompen ni inventan etiquetas", () => {
    expect([hourOf("2027-07-10T25:00"), hourOf("basura"), hourOf(null), hourOf(undefined), hourOf("2027-07-10")]).toEqual([null, null, null, null, null]);
    expect(hourOf("2027-07-10T18:30")).toBe(18.5);
    const it = trip([{ city: "NYC", check_in: "no-es-fecha", check_out: "2027-07-12" }]);
    const bad = { id: "Z", depart_at: undefined, arrive_at: "x" } as unknown as FlightOffer;
    const days = timeline(it, [bad], (c) => c);
    expect(days.length).toBe(1); // solo la fecha válida
    expect(() => groupByStay(days, it.stays)).not.toThrow();
    expect(timeline(trip([]), [], (c) => c)).toEqual([]);
    expect(groupByStay([], [])).toEqual([]);
    // un rango absurdo queda acotado
    expect(timeline(trip([{ city: "NYC", check_in: "2027-01-01", check_out: "2099-01-01" }]), [], (c) => c).length).toBe(120);
  });
});
