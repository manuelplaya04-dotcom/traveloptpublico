import { describe, expect, it } from "vitest";
import { ARRIVAL_CUTOFFS, arrivesBy, cheapestArrivingBy, flightRejection, legRole, type FlightOption, type Leg } from "@/lib/flights";
import { airlineLabel, flightNumbers, stopsOf, stopsSummary } from "@/lib/flightDetail";
import { GOLDEN, initialState } from "@/lib/onboarding";
import type { FlightOffer } from "@/lib/types";

// Forma real del adaptador (respuesta grabada de Google Flights: MCO → ATL → LGA).
const offer = (over: Partial<FlightOffer> = {}): FlightOffer => ({
  id: "x", provider: "serpapi_google_flights", origin: "MCO", destination: "LGA",
  depart_at: "2027-01-15T06:00:00", arrive_at: "2027-01-15T11:22:00", stops: 1, carrier: "F9",
  segments: [
    { flight_number: "F9 1241", airline: "Frontier", origin: "MCO", destination: "ATL" },
    { flight_number: "F9 3458", airline: "Frontier", origin: "ATL", destination: "LGA" },
  ],
  layovers: [{ airport: "ATL", name: "Hartsfield-Jackson Atlanta International Airport", duration_min: 142 }],
  price_per_pax_minor: 10000, included_bags: 0, bag_fee_minor: 0, seats_available: 9, deeplink: null, ...over,
});

describe("aerolínea, vuelos y escalas: solo lo que informa el proveedor", () => {
  it("con el detalle real: nombre de la aerolínea, números de vuelo y aeropuerto de escala", () => {
    const f = offer();
    expect(airlineLabel(f)).toBe("Frontier");
    expect(flightNumbers(f)).toBe("F9 1241 · F9 3458");
    expect(stopsSummary(f)).toBe("1 escala en ATL");
    expect(stopsOf(f)).toEqual([{ airport: "ATL", name: "Hartsfield-Jackson Atlanta International Airport", wait: "2 h 22 min" }]);
  });

  it("varias aerolíneas y escalas se listan sin repetir", () => {
    const f = offer({
      stops: 2,
      segments: [
        { flight_number: "AR 1300", airline: "Aerolíneas Argentinas", origin: "EZE", destination: "LIM" },
        { flight_number: "LA 2400", airline: "LATAM", origin: "LIM", destination: "PTY" },
        { flight_number: "LA 2401", airline: "LATAM", origin: "PTY", destination: "MIA" },
      ],
      layovers: [{ airport: "LIM" }, { airport: "PTY", duration_min: 60 }],
    });
    expect(airlineLabel(f)).toBe("Aerolíneas Argentinas + LATAM");
    expect(stopsSummary(f)).toBe("2 escalas: LIM y PTY");
  });

  it("sin el detalle (oferta vieja, de prueba o incompleta) se dice no informado, nunca se deduce", () => {
    const old = offer({ segments: undefined, layovers: undefined, carrier: "AA", stops: 1 });
    expect(airlineLabel(old)).toBe("American Airlines"); // el código sale del número de vuelo
    expect(airlineLabel({ ...old, carrier: "JA" })).toBe("JA"); // código sin nombre conocido: tal cual
    expect(flightNumbers(old)).toBeNull();
    expect(stopsSummary(old)).toBe("1 escala (aeropuerto no informado)");
    expect(stopsOf(old)).toEqual([{ airport: null, name: null, wait: null }]);
    expect(stopsSummary(offer({ stops: 2, layovers: [{ airport: "LIM" }, { airport: null }] }))).toBe("2 escalas: LIM y no informado");
    expect(stopsSummary(offer({ stops: 0, layovers: [], segments: undefined }))).toBe("Directo");
  });
});

const opt = (id: string, arrive: string, cost: number, rejection: string | null = null): FlightOption =>
  ({ offer: offer({ id, arrive_at: `2027-01-15T${arrive}:00` }), costMinor: cost, rejection }) as FlightOption;

describe("filtro por hora de llegada (local, sin búsquedas nuevas)", () => {
  it("llegar antes de una hora incluye la hora exacta", () => {
    expect(arrivesBy(offer({ arrive_at: "2027-01-15T12:00:00" }), 12)).toBe(true);
    expect(arrivesBy(offer({ arrive_at: "2027-01-15T12:01:00" }), 12)).toBe(false);
    expect(ARRIVAL_CUTOFFS[0]).toBe(8);
  });

  it("la alternativa a un clic es la más barata que llega a tiempo, sin las descartadas", () => {
    const opts = [opt("tarde", "23:10", 100), opt("cara", "09:00", 500), opt("barata", "11:30", 300),
      opt("descartada", "07:00", 50, "flight.too_many_stops")];
    expect(cheapestArrivingBy(opts, 12)?.offer.id).toBe("barata");
    expect(cheapestArrivingBy(opts, 8)).toBeUndefined();
  });
});

describe("tramos y franja horaria", () => {
  it("cada tramo se nombra por su papel en el viaje", () => {
    expect(legRole({ from: "HOME", to: "ORL" } as Leg)).toBe("Ida");
    expect(legRole({ from: "ORL", to: "NYC" } as Leg)).toBe("Interconexión");
    expect(legRole({ from: "NYC", to: "HOME" } as Leg)).toBe("Vuelta");
  });

  it("un viaje nuevo no trae hora mínima ni máxima oculta; el caso de ejemplo conserva las suyas", () => {
    const c = initialState("2026-11-19").constraints;
    expect([c.earliest_departure_hour, c.latest_arrival_hour]).toEqual([null, null]);
    expect([GOLDEN.constraints.earliest_departure_hour, GOLDEN.constraints.latest_arrival_hour]).toEqual([6, 23]);
    const leg = { arriveOn: "2027-01-15" } as Leg;
    const dawn = offer({ depart_at: "2027-01-15T01:30:00", arrive_at: "2027-01-15T23:50:00", stops: 0 });
    expect(flightRejection(dawn, leg, c, 2)).toBeNull(); // madrugada y llegada tarde: válidas sin franja
    expect(flightRejection(dawn, leg, GOLDEN.constraints, 2)).toBe("flight.departs_too_early");
  });
});
