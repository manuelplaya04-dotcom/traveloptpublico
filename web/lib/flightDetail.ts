// Detalle de un vuelo para la interfaz: aerolínea, números de vuelo y escalas, SOLO con lo que informó el proveedor.
// Lo ausente se dice ("no informado"): nunca se deduce un aeropuerto de escala ni una aerolínea. Funciones puras.
import { airlineName, fmtDuration } from "@/lib/format";
import type { FlightOffer } from "@/lib/types";

/** Aerolínea(s) del itinerario. Con segmentos, los nombres que da el proveedor (sin repetir); si no, el código del
 *  número de vuelo traducido con la tabla de nombres conocidos, o el código tal cual. */
export function airlineLabel(f: Pick<FlightOffer, "carrier" | "segments">): string {
  const names = [...new Set((f.segments ?? []).map((s) => s.airline ?? airlineName(s.flight_number.slice(0, 2))))];
  return names.length ? names.join(" + ") : airlineName(f.carrier);
}

/** "F9 1241 · F9 3458", o null si el proveedor no informó los vuelos. */
export function flightNumbers(f: Pick<FlightOffer, "segments">): string | null {
  return f.segments?.length ? f.segments.map((s) => s.flight_number).join(" · ") : null;
}

export type Stop = { airport: string | null; name: string | null; wait: string | null };

/** Una entrada por escala. Sin el dato del proveedor (oferta vieja o de prueba), las escalas existen pero sin aeropuerto. */
export function stopsOf(f: Pick<FlightOffer, "stops" | "layovers">): Stop[] {
  if (f.layovers) {
    return f.layovers.map((l) => ({ airport: l.airport ?? null, name: l.name ?? null, wait: fmtDuration(l.duration_min) || null }));
  }
  return Array.from({ length: f.stops }, () => ({ airport: null, name: null, wait: null }));
}

/** Resumen para la línea del recorrido: "Directo", "1 escala en ATL", "2 escalas: ATL y PTY",
 *  "1 escala (aeropuerto no informado)". */
export function stopsSummary(f: Pick<FlightOffer, "stops" | "layovers">): string {
  const stops = stopsOf(f);
  if (stops.length === 0) return "Directo";
  const count = `${stops.length} escala${stops.length > 1 ? "s" : ""}`;
  const codes = stops.map((s) => s.airport);
  if (codes.every((c) => c === null)) return `${count} (aeropuerto no informado)`;
  const list = codes.map((c) => c ?? "no informado");
  return stops.length === 1 ? `${count} en ${list[0]}` : `${count}: ${list.slice(0, -1).join(", ")} y ${list.at(-1)}`;
}
