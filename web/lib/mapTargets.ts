// A dónde apunta "Ver en mapa" para cada tipo de tarjeta. Todo sale de datos que ya están en el navegador: el payload
// de la corrida (alojamiento, actividades), la respuesta de lugares ya cargada, y tablas estáticas de posiciones
// públicas (aeropuertos y estadios). Nunca se geocodifica: si no hay coordenadas, no hay botón.
import { AIRPORT_COORDS } from "@/lib/airports";
import { cityByCode } from "@/lib/cities";
import { hasCoords } from "@/lib/geo";
import type { MapFocus } from "@/lib/mapFocus";

// Estadios y arenas de lib/sports.ts (y donde suelen caer los eventos). Posición pública del recinto.
export const VENUE_COORDS: Record<string, { lat: number; lon: number }> = {
  "Madison Square Garden": { lat: 40.7505, lon: -73.9934 },
  "Yankee Stadium": { lat: 40.8296, lon: -73.9262 },
  "Citi Field": { lat: 40.7571, lon: -73.8458 },
  "MetLife Stadium": { lat: 40.8135, lon: -74.0745 },
  "Barclays Center": { lat: 40.6826, lon: -73.9754 },
  "Kia Center": { lat: 28.5392, lon: -81.3839 },
  "Inter&Co Stadium": { lat: 28.5411, lon: -81.3893 },
  "Kaseya Center": { lat: 25.7814, lon: -80.187 },
  "loanDepot park": { lat: 25.7781, lon: -80.2196 },
  "Hard Rock Stadium": { lat: 25.958, lon: -80.2389 },
  "Amerant Bank Arena": { lat: 26.1584, lon: -80.3256 },
  "Chase Stadium": { lat: 26.193, lon: -80.1611 },
  "Wells Fargo Center": { lat: 39.9012, lon: -75.172 },
  "Citizens Bank Park": { lat: 39.9061, lon: -75.1665 },
  "Lincoln Financial Field": { lat: 39.9008, lon: -75.1675 },
  "Subaru Park": { lat: 39.8328, lon: -75.3786 },
  "TD Garden": { lat: 42.3662, lon: -71.0621 },
  "Fenway Park": { lat: 42.3467, lon: -71.0972 },
  "Gillette Stadium": { lat: 42.0909, lon: -71.2643 },
  "Capital One Arena": { lat: 38.8981, lon: -77.0209 },
  "Nationals Park": { lat: 38.873, lon: -77.0074 },
  "Audi Field": { lat: 38.8687, lon: -77.0128 },
};
const VENUE_BY_FOLD = new Map(Object.entries(VENUE_COORDS).map(([k, v]) => [k.toLowerCase(), v]));

/** Recinto conocido por nombre exacto (sin mayúsculas). Un evento en otro lugar no tiene botón. */
export function venueFocus(city: string, venue: string | null | undefined): MapFocus | null {
  const c = venue ? VENUE_BY_FOLD.get(venue.trim().toLowerCase()) : undefined;
  return c ? { ...c, city, label: venue!.trim(), kind: "venue" } : null;
}

/** Punto con coordenadas del payload (alojamiento, actividad, lugar); null si el proveedor no las informó. */
export function pointFocus(city: string, label: string, kind: MapFocus["kind"],
  p: { lat?: number | null; lon?: number | null }): MapFocus | null {
  return hasCoords(p) ? { lat: p.lat, lon: p.lon, city, label, kind } : null;
}

/**
 * Aeropuerto de un vuelo en el mapa de una ciudad del viaje: primero el de llegada, si no el de salida (la vuelta a
 * casa sale de una ciudad del viaje). `cities` son los códigos del itinerario: sin mapa para esa ciudad, sin botón.
 */
export function airportFocus(flight: { origin: string; destination: string }, cities: string[]): MapFocus | null {
  for (const code of [flight.destination, flight.origin]) {
    const a = AIRPORT_COORDS[code];
    const city = a && cities.find((c) => cityByCode(c)?.airports.includes(code));
    if (a && city) return { lat: a.lat, lon: a.lon, city, label: `Aeropuerto ${a.name}`, kind: "airport" };
  }
  return null;
}
