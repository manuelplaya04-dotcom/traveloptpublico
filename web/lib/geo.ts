// Distancias para evaluar la logística del día. Es una estimación: línea recta (haversine) con un factor de ruteo
// urbano y velocidades medias; el ruteo real por calles llega con OpenRouteService (Fase 6.5).
export type LatLon = { lat: number; lon: number };

const EARTH_KM = 6371;
const ROUTE_FACTOR = 1.3; // las calles nunca van en línea recta: +30% sobre la distancia directa
const WALK_KMH = 4.8;
const CAR_KMH = 25; // promedio urbano con semáforos y tránsito
const WALK_MAX_KM = 1.5; // hasta acá conviene caminar

export function haversineKm(a: LatLon, b: LatLon): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

// estimated: true = línea recta con factor de ruteo (sin datos de calles); false = ruta real por calle (OSRM).
export type Trip = { km: number; minutes: number; mode: "a pie" | "en auto"; estimated?: boolean };

/** Distancia por calle estimada y tiempo, caminando si es cerca o en auto si no. */
export function estimateTrip(from: LatLon, to: LatLon): Trip {
  const km = haversineKm(from, to) * ROUTE_FACTOR;
  const walk = km <= WALK_MAX_KM;
  const minutes = Math.max(1, Math.round((km / (walk ? WALK_KMH : CAR_KMH)) * 60));
  return { km: Math.round(km * 10) / 10, minutes, mode: walk ? "a pie" : "en auto", estimated: true };
}

/** Ruta real por calle (OSRM): cerca se camina (tiempo a pie sobre la distancia real), lejos el tiempo en auto. */
export function roadTrip(r: { distance_m: number; duration_s: number }): Trip {
  const km = r.distance_m / 1000;
  const walk = km <= WALK_MAX_KM;
  const minutes = Math.max(1, Math.round(walk ? (km / WALK_KMH) * 60 : r.duration_s / 60));
  return { km: Math.round(km * 10) / 10, minutes, mode: walk ? "a pie" : "en auto", estimated: false };
}

// Acepta null/undefined (p. ej. sin alojamiento cotizado): no hay punto que ubicar.
export const hasCoords = <T extends { lat?: number | null; lon?: number | null }>(p: T | null | undefined): p is T & LatLon =>
  typeof p?.lat === "number" && typeof p?.lon === "number";

const KM_FORMAT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }); // reutilizado: ver DAY_FORMAT en format.ts
export const fmtTrip = (t: Trip) =>
  `${KM_FORMAT.format(t.km)} km · ~${t.minutes} min ${t.mode}`;
