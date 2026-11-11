import { afterEach, describe, expect, it, vi } from "vitest";
import { _reset, focusOnMap, onMapFocus, type MapFocus } from "../lib/mapFocus";
import { airportFocus, pointFocus, VENUE_COORDS, venueFocus } from "../lib/mapTargets";
import { TEAMS_BY_CITY } from "../lib/sports";

const MK: MapFocus = { lat: 28.4177, lon: -81.5812, city: "ORL", label: "Magic Kingdom", kind: "activity" };

afterEach(() => _reset());

describe("bus lista ↔ mapa", () => {
  it("solo avisa al mapa de la ciudad pedida", () => {
    const orl = vi.fn();
    const nyc = vi.fn();
    onMapFocus("ORL", orl);
    onMapFocus("NYC", nyc);
    expect(focusOnMap(MK)).toBe(true);
    expect(orl).toHaveBeenCalledWith(MK);
    expect(nyc).not.toHaveBeenCalled();
  });

  it("un mapa que monta tarde toma el pedido reciente una sola vez, y nunca uno viejo", () => {
    focusOnMap(MK, 1_000);
    const late = vi.fn();
    onMapFocus("ORL", late, 3_000);
    expect(late).toHaveBeenCalledWith(MK);
    const again = vi.fn();
    onMapFocus("ORL", again, 3_500); // remontar el mapa no repite el vuelo
    expect(again).not.toHaveBeenCalled();
    focusOnMap(MK, 20_000);
    _reset();
    focusOnMap(MK, 1_000);
    const stale = vi.fn();
    onMapFocus("ORL", stale, 12_000);
    expect(stale).not.toHaveBeenCalled();
  });

  it("el planificador escucha todas las ciudades y no consume el pedido (lo toma el mapa al montar)", () => {
    const planner = vi.fn();
    onMapFocus(null, planner);
    focusOnMap(MK, 1_000);
    expect(planner).toHaveBeenCalledWith(MK);
    const map = vi.fn();
    onMapFocus("ORL", map, 2_000);
    expect(map).toHaveBeenCalledWith(MK);
  });

  it("al desuscribirse deja de recibir y rechaza coordenadas inválidas", () => {
    const l = vi.fn();
    const off = onMapFocus("ORL", l);
    off();
    focusOnMap(MK);
    expect(l).not.toHaveBeenCalled();
    expect(focusOnMap({ ...MK, lat: Number.NaN })).toBe(false);
    expect(focusOnMap({ ...MK, lon: 200 })).toBe(false);
  });
});

describe("a dónde apunta cada tarjeta (sin geocodificar)", () => {
  it("vuelos: aeropuerto de llegada; en la vuelta, el de salida; fuera del viaje, sin botón", () => {
    expect(airportFocus({ origin: "EZE", destination: "MCO" }, ["ORL", "NYC"])).toMatchObject({ city: "ORL", kind: "airport" });
    expect(airportFocus({ origin: "JFK", destination: "EZE" }, ["ORL", "NYC"])).toMatchObject({ city: "NYC", lat: 40.6413 });
    expect(airportFocus({ origin: "JFK", destination: "EZE" }, ["BKN"])).toMatchObject({ city: "BKN" });
    expect(airportFocus({ origin: "EZE", destination: "MIA" }, ["ORL"])).toBeNull();
  });

  it("alojamiento, actividades y lugares usan las coordenadas del payload; sin ellas, null", () => {
    expect(pointFocus("ORL", "Hotel", "lodging", { lat: 28.4, lon: -81.5 })).toMatchObject({ lat: 28.4, kind: "lodging" });
    expect(pointFocus("ORL", "Hotel", "lodging", { lat: null, lon: -81.5 })).toBeNull();
    expect(pointFocus("ORL", "Hotel", "lodging", {})).toBeNull();
  });

  it("estadios: todos los de la tabla de deportes tienen ubicación, y el evento se reconoce por su recinto", () => {
    for (const teams of Object.values(TEAMS_BY_CITY)) for (const t of teams) expect(VENUE_COORDS[t.venue], t.venue).toBeDefined();
    expect(venueFocus("NYC", " madison square garden ")).toMatchObject({ lat: 40.7505, kind: "venue" });
    expect(venueFocus("NYC", "Un bar cualquiera")).toBeNull();
    expect(venueFocus("NYC", null)).toBeNull();
  });
});
