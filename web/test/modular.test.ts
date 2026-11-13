import { describe, expect, it } from "vitest";
import { totals, type Cart } from "../lib/cart";
import { OWN_LODGING, quotedTransport, rubros, timeline } from "../lib/checkout";
import { ALL_SERVICES, NO_SERVICE_SELECTED, servicesSchema, tripRequestSchema } from "../lib/contracts";
import { buildTripRequest, GOLDEN, validate, type OnboardingState } from "../lib/onboarding";
import { hasSeen, markSeen, ONBOARDING_TOUR, RESULTS_TOUR, tourKey } from "../lib/tour";
import type { ItineraryPayload, TransportQuote } from "../lib/types";

const TODAY = "2026-11-01";
const withServices = (services: OnboardingState["services"]): OnboardingState => ({ ...GOLDEN, services });

describe("servicios a cotizar (contrato)", () => {
  it("estrictos: sin coerción ni campos de más, y al menos uno", () => {
    expect(servicesSchema.safeParse({ flights: "false", lodging: true, activities: true }).success).toBe(false);
    expect(servicesSchema.safeParse({ ...ALL_SERVICES, cars: true }).success).toBe(false);
    const none = servicesSchema.safeParse({ flights: false, lodging: false, activities: false });
    expect(none.success ? [] : none.error.issues.map((i) => i.message)).toEqual([NO_SERVICE_SELECTED]);
  });

  it("una corrida anterior a los módulos (sin `services`) se lee como 'todo cotizado'", () => {
    const old = { ...buildTripRequest(GOLDEN) } as Record<string, unknown>;
    delete old.services;
    expect(tripRequestSchema.parse(old).services).toEqual(ALL_SERVICES);
  });

  it("el origen es obligatorio solo para cotizar vuelos", () => {
    const req = buildTripRequest(GOLDEN);
    expect(tripRequestSchema.safeParse({ ...req, origin_airports: [] }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ ...req, origin_airports: [], services: { ...ALL_SERVICES, flights: false } }).success).toBe(true);
  });
});

describe("formulario modular", () => {
  it("sin ningún servicio el paso de destinos no avanza y dice por qué", () => {
    expect(validate(withServices({ flights: false, lodging: false, activities: false }), TODAY).destinations)
      .toEqual([NO_SERVICE_SELECTED]);
  });

  it("sin vuelos no manda origen; sin actividades no manda imperdibles", () => {
    const noFlights = buildTripRequest(withServices({ flights: false, lodging: true, activities: true }));
    expect(noFlights.origin_airports).toEqual([]);
    expect(noFlights.services.flights).toBe(false);
    const noActs = buildTripRequest(withServices({ flights: true, lodging: true, activities: false }));
    expect(noActs.cities.every((c) => c.must_do.length === 0)).toBe(true);
    expect(buildTripRequest(GOLDEN).cities.some((c) => c.must_do.length > 0)).toBe(true);
  });
});

describe("itinerario sin un módulo", () => {
  const cart: Cart = { base: { actividades: 508000, transporte: 77200 }, optimal: {}, selected: {} };

  it("el resumen omite los rubros no cotizados (no los muestra en USD 0)", () => {
    const r = rubros(totals(cart), [], () => 0, { flights: false, lodging: false, activities: true });
    expect(r.map((x) => x.key)).toEqual(["actividades", "transporte"]);
    expect(r.reduce((a, x) => a + x.minor, 0)).toBe(585200);
  });

  it("sin vuelos no hay traslados al aeropuerto", () => {
    const q = (mode: TransportQuote["mode"]) => ({ id: mode, city: "NYC", mode }) as TransportQuote;
    expect(quotedTransport([q("car_rental"), q("transfers")], { ...ALL_SERVICES, flights: false }).map((x) => x.mode))
      .toEqual(["car_rental"]);
    expect(quotedTransport([q("transfers")], ALL_SERVICES)).toHaveLength(1);
  });

  it("sin vuelos el calendario arranca en el destino, sin días de traslado", () => {
    const it = { stays: [{ city: "NYC", check_in: "2027-07-10", check_out: "2027-07-12", activities: [] }] } as unknown as ItineraryPayload;
    const days = timeline(it, [], () => OWN_LODGING);
    expect(days.map((d) => d.date)).toEqual(["2027-07-10", "2027-07-11", "2027-07-12"]);
    expect(days[0]).toMatchObject({ index: 1, sleep: { city: "NYC", lodging: OWN_LODGING }, tags: [] });
  });
});

describe("recorrido guiado", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it("se muestra una sola vez por navegador", () => {
    const s = memory();
    expect(hasSeen(s, "onboarding")).toBe(false);
    markSeen(s, "onboarding");
    expect(hasSeen(s, "onboarding")).toBe(true);
    expect(s.getItem(tourKey("onboarding"))).toBe("1");
    expect(hasSeen(s, "results")).toBe(false); // cada recorrido por separado
  });

  it("sin almacenamiento usable no se muestra ni rompe", () => {
    const broken = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("lleno"); } };
    expect(hasSeen(broken, "onboarding")).toBe(true);
    expect(hasSeen(null, "onboarding")).toBe(true);
    expect(() => markSeen(broken, "onboarding")).not.toThrow();
  });

  it("el primer paso explica cómo desactivar lo que ya se tiene", () => {
    expect(ONBOARDING_TOUR.steps[0].target).toBe("services");
    for (const t of [ONBOARDING_TOUR, RESULTS_TOUR]) {
      expect(new Set(t.steps.map((s) => s.target)).size).toBe(t.steps.length);
      expect(t.steps.every((s) => s.title && s.body.length <= 140)).toBe(true);
    }
  });
});
