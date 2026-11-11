import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { totals, select, type Cart } from "../lib/cart";
import { tripRequestSchema } from "../lib/contracts";
import { legOptions, legsFor } from "../lib/flights";
import type { FlightOffer, ItineraryPayload } from "../lib/types";

const fx = (f: string) => JSON.parse(readFileSync(resolve(process.cwd(), "..", "engine/fixtures/orlando_nyc_5pax", f), "utf8"));
const req = tripRequestSchema.parse(fx("trip_request.json"));
const offers: FlightOffer[] = fx("flights.json");
// Esqueleto óptimo ORL-NYC|2027-07-08|8-4 (solo lo que usa legsFor).
const best = { stays: [
  { city: "ORL", check_in: "2027-07-08", check_out: "2027-07-16" },
  { city: "NYC", check_in: "2027-07-16", check_out: "2027-07-20" },
] } as unknown as ItineraryPayload;

describe("hub de vuelos (port del motor)", () => {
  const legs = legsFor(req, best);
  const options = legs.map((l) => legOptions(l, offers, req));

  it("arma ida, interconexión y regreso", () => {
    expect(legs.map((l) => `${l.from}->${l.to}`)).toEqual(["HOME->ORL", "ORL->NYC", "NYC->HOME"]);
    expect(legs[0].departDates).toEqual(["2027-07-07", "2027-07-08"]); // ida nocturna permitida
  });

  it("la opción más barata elegible de cada tramo es la del óptimo, al centavo", () => {
    expect(options.map((o) => [o[0].offer.id, o[0].costMinor])).toEqual([["F02", 465000], ["F13", 88500], ["F21", 495000]]);
    expect(options.flat().length).toBeGreaterThanOrEqual(5);
  });

  it("marca los descartes con el mismo motivo que el embudo", () => {
    const rejected = Object.fromEntries(options.flat().filter((o) => o.rejection).map((o) => [o.offer.id, o.rejection]));
    expect(rejected).toMatchObject({ F14: "flight.departs_too_early" });
  });
});

describe("carrito", () => {
  const pick = (id: string, costMinor: number) => ({ id, label: id, category: "vuelos" as const, costMinor });
  const cart: Cart = {
    base: { vuelos: 1048500, alojamiento: 355662, actividades: 508000, transporte: 96200 },
    optimal: { "flight:0": pick("F02", 465000) },
    selected: {},
  };

  it("sin cambios reproduce el total del motor", () => {
    expect(totals(cart)).toEqual({ byCategory: cart.base, totalMinor: 2008362, deltaMinor: 0, changed: 0 });
  });

  it("cambiar un vuelo mueve la categoría y el total por la diferencia exacta", () => {
    const t = totals(select(cart, "flight:0", pick("F03", 500000)));
    expect(t.byCategory.vuelos).toBe(1083500);
    expect([t.totalMinor, t.deltaMinor, t.changed]).toEqual([2043362, 35000, 1]);
  });
});
