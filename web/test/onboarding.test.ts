import { describe, expect, it } from "vitest";
import demo from "../lib/demo-case.json";
import { MAX_CITIES } from "../lib/cities";
import { buildTripRequest, GOLDEN, initialState, returnBounds, returnDate, toggleCity, validate, withReturnDate, type OnboardingState } from "../lib/onboarding";

const TODAY = "2026-11-01";
const errors = (patch: Partial<OnboardingState>) => validate({ ...GOLDEN, ...patch }, TODAY);
const constraints = (patch: Partial<OnboardingState["constraints"]>) =>
  errors({ constraints: { ...GOLDEN.constraints, ...patch } });

describe("onboarding", () => {
  it("CP-4b.1: los valores por defecto piden el caso golden con el reparto de su óptimo (8 + 4 noches)", () => {
    const fixed = { ...demo, case_key: null, cities: demo.cities.map((c) => {
      const n = c.code === "ORL" ? 8 : 4;
      return { ...c, name: c.code === "ORL" ? "Orlando" : "Nueva York", min_nights: n, max_nights: n };
    }) };
    expect(buildTripRequest(GOLDEN)).toEqual(fixed);
    expect(errors({})).toEqual({ destinations: [], dates: [], preferences: [] });
  });

  it("CP-4b.2: valida destinos, fechas y duración", () => {
    expect(errors({ cities: [] }).destinations).toHaveLength(1);
    expect(errors({ cities: [{ code: "ORL", nights: 30 }], totalNights: 30 }).destinations[0]).toMatch(/Orlando/);
    expect(errors({ pax: 0 }).dates).toContain("Entre 1 y 9 viajeros.");
  });

  it("la suma de noches por ciudad tiene que coincidir con la duración del viaje", () => {
    expect(errors({ totalNights: 14 }).destinations[0]).toMatch(/Asignaste 12 noches y el viaje dura 14: te falta repartir 2/);
    expect(errors({ totalNights: 10 }).destinations[0]).toMatch(/sobran 2/);
    expect(errors({ cities: [{ code: "ORL", nights: 6 }, { code: "NYC", nights: 6 }] }).destinations).toEqual([]);
  });

  it("acepta destinos dinámicos, más allá de dos, hasta el tope del contrato", () => {
    const four = [{ code: "ORL", nights: 3 }, { code: "NYC", nights: 3 }, { code: "MIA", nights: 3 }, { code: "BOS", nights: 3 }];
    expect(errors({ cities: four }).destinations).toEqual([]);
    expect(buildTripRequest({ ...GOLDEN, cities: four }).cities.map((c) => c.code)).toEqual(["ORL", "NYC", "MIA", "BOS"]);
    const five = [...four, { code: "WAS", nights: 3 }];
    expect(errors({ cities: five, totalNights: 15 }).destinations).toContain(`Podés elegir hasta ${MAX_CITIES} destinos.`);
    expect(errors({ cities: [{ code: "XXX", nights: 12 }] }).destinations[0]).toMatch(/desconocido/);
  });

  it("un campo numérico vacío (NaN) no pasa la validación ni llega a construir el pedido", () => {
    expect(errors({ totalNights: NaN }).destinations[0]).toMatch(/duración/);
    expect(errors({ cities: [{ code: "ORL", nights: NaN }, { code: "NYC", nights: 4 }] }).destinations[0]).toMatch(/Orlando/);
    expect(errors({ pax: NaN }).dates).toContain("Entre 1 y 9 viajeros.");
    expect(errors({ budget: NaN }).dates).toContain("Indicá un presupuesto mayor a cero.");
    expect(constraints({ min_bathrooms: NaN }).preferences[0]).toMatch(/Baños mínimos/);
    expect(constraints({ max_heavy_rain_prob: 2 }).preferences[0]).toMatch(/Lluvia/);
  });

  it("respeta el orden elegido y convierte el presupuesto a centavos", () => {
    const req = buildTripRequest({ ...GOLDEN, cities: [...GOLDEN.cities].reverse(), budget: 19999.99 });
    expect(req.cities.map((c) => c.code)).toEqual(["NYC", "ORL"]);
    expect(req.budget_minor).toBe(1999999);
    expect(req.fixed_order).toBe(true);
  });

  it("ida, vuelta y duración están vinculadas: la vuelta es ida + noches", () => {
    expect(returnDate(GOLDEN)).toBe("2027-07-20"); // 8 jul + 12 noches
    expect(returnDate({ departDate: "2027-07-08", totalNights: 5 })).toBe("2027-07-13");
    expect(returnDate({ departDate: "", totalNights: 5 })).toBeUndefined();
    expect(returnDate({ departDate: "2027-07-08", totalNights: NaN })).toBeUndefined();
    expect(returnBounds("2027-07-08")).toEqual({ min: "2027-07-09", max: "2027-09-06" }); // 1 a 60 noches
  });

  it("elegir la vuelta recalcula las noches y ajusta la última ciudad", () => {
    expect(withReturnDate(GOLDEN, "2027-07-22")).toEqual({
      totalNights: 14, cities: [{ code: "ORL", nights: 8 }, { code: "NYC", nights: 6 }] });
    expect(withReturnDate(GOLDEN, "2027-07-08")).toEqual({}); // misma fecha que la ida: 0 noches, se ignora
    expect(withReturnDate(GOLDEN, "2027-07-01")).toEqual({}); // antes de la ida
    expect(withReturnDate(GOLDEN, "2029-01-01")).toEqual({}); // más de 60 noches
  });

  it("no acepta fechas pasadas, inexistentes ni años absurdos", () => {
    expect(errors({ departDate: "2026-10-31" }).dates).toContain("La fecha de ida no puede estar en el pasado.");
    expect(errors({ departDate: "2026-11-01" }).dates).toEqual([]); // hoy sí
    expect(errors({ departDate: "+102027-07-08" }).dates).toContain("Elegí una fecha de ida válida.");
    expect(errors({ departDate: "2027-02-30" }).dates).toContain("Elegí una fecha de ida válida.");
    expect(errors({ departDate: "2030-01-01" }).dates).toContain("Podés planificar hasta 2 años adelante.");
    expect(errors({ flexDays: 9 }).dates[0]).toMatch(/flexibilidad/);
  });

  it("la ventana de salida que recibe el motor es ida + flexibilidad", () => {
    const req = buildTripRequest({ ...GOLDEN, departDate: "2027-03-10", flexDays: 2 });
    expect([req.first_checkin_from, req.first_checkin_to]).toEqual(["2027-03-10", "2027-03-12"]);
    expect(req.cities.map((c) => c.name)).toEqual(["Orlando", "Nueva York"]);
  });

  it("un viaje nuevo arranca hoy y sin destinos (nunca una fecha fija)", () => {
    expect(initialState("2026-11-01")).toMatchObject({ departDate: "2026-11-01", cities: [], flexDays: 0 });
    expect(validate(initialState("2026-11-01"), "2026-11-01").dates).toEqual([]);
  });

  it("toggle de destinos: agrega, vuelve a tocar y quita; la duración acompaña si estaba cuadrada", () => {
    const empty = initialState("2026-11-01");
    const one = { ...empty, ...toggleCity(empty, "MIA") };
    expect(one.cities).toEqual([{ code: "MIA", nights: 4 }]);
    expect(one.totalNights).toBe(4);
    const two = { ...one, ...toggleCity(one, "BOS") };
    expect(two.cities.map((c) => c.code)).toEqual(["MIA", "BOS"]);
    expect(two.totalNights).toBe(7);
    const back = { ...two, ...toggleCity(two, "MIA") };
    expect(back.cities).toEqual([{ code: "BOS", nights: 3 }]);
    expect(back.totalNights).toBe(3);
    expect(toggleCity(empty, "XXX")).toEqual({});
  });
});

describe("buscador y reparto", () => {
  it("busca sin acentos por ciudad o país y excluye las elegidas", async () => {
    const { searchCities } = await import("../lib/cities");
    expect(searchCities("filadelfia").map((c) => c.code)).toEqual(["PHL"]);
    expect(searchCities("Washington").map((c) => c.code)).toEqual(["WAS"]);
    expect(searchCities("boston", ["BOS"])).toEqual([]);
    expect(searchCities("paris")).toEqual([]); // Fase 1: solo 8 ciudades de EE.UU.
    expect(searchCities("estados unidos")).toHaveLength(6); // tope de sugerencias
    expect(searchCities("   ")).toEqual([]);
    expect(searchCities("Ciudad Inventada")).toEqual([]);
  });
  it("cambiar noches con − / + mueve la duración si el reparto estaba cuadrado", async () => {
    const { withCities } = await import("../lib/onboarding");
    const s = { ...GOLDEN };
    expect(withCities(s, [{ code: "ORL", nights: 9 }, { code: "NYC", nights: 4 }])).toMatchObject({ totalNights: 13 });
    const off = { ...GOLDEN, totalNights: 20 };
    expect(withCities(off, [{ code: "ORL", nights: 9 }, { code: "NYC", nights: 4 }])).not.toHaveProperty("totalNights");
  });
});

describe("Fase 1: catálogo y calibración", () => {
  it("solo las 7 ciudades de la costa este (V1)", async () => {
    const { CITIES } = await import("../lib/cities");
    expect(CITIES.map((c) => c.name).sort()).toEqual(
      ["Boston", "Brooklyn", "Filadelfia", "Miami", "Nueva York", "Orlando", "Washington D.C."]);
  });
  it("los imperdibles nunca superan lo que entra en las noches asignadas", () => {
    const req = (orl: number, nyc: number) =>
      buildTripRequest({ ...GOLDEN, cities: [{ code: "ORL", nights: orl }, { code: "NYC", nights: nyc }], totalNights: orl + nyc });
    expect(req(8, 4).cities.map((c) => c.must_do.length)).toEqual([5, 3]); // golden intacto
    expect(req(3, 1).cities.map((c) => c.must_do.length)).toEqual([1, 0]);
    expect(req(5, 2).cities.map((c) => c.must_do)).toEqual([["MK", "EPCOT", "HS"], ["SOL", "TOR"]]);
  });
  it("Brooklyn y Nueva York no se combinan (mismos aeropuertos)", () => {
    const e = validate({ ...GOLDEN, cities: [{ code: "NYC", nights: 4 }, { code: "BKN", nights: 8 }] }, TODAY);
    expect(e.destinations[0]).toMatch(/comparten aeropuertos/);
  });
});
