// "Ver en mapa": canal entre las tarjetas (vuelos, alojamiento, actividades, lugares, eventos, deportes) y el mapa de
// cada ciudad. Es un bus en memoria, fuera de React: la tarjeta llama a focusOnMap() y solo el mapa de esa ciudad
// reacciona (mueve la vista y resalta el pin). Ni la lista ni el layout se redibujan, y no hay ninguna llamada de red:
// las coordenadas ya vienen en el payload guardado (o en tablas estáticas, como aeropuertos y estadios).
import type { LatLon } from "@/lib/geo";

export type MapFocus = LatLon & { city: string; label: string; kind: "lodging" | "activity" | "place" | "airport" | "venue" };
type Listener = (f: MapFocus) => void;

const listeners = new Set<Listener>();
let pending: { focus: MapFocus; at: number } | null = null;
// Desde vuelos el mapa todavía no existe: el planificador cambia al paso de la ciudad y el mapa (carga diferida) toma
// el pedido al montar, si es reciente. Se entrega una sola vez.
const PENDING_MS = 10_000;

const valid = (f: MapFocus) =>
  Number.isFinite(f.lat) && Number.isFinite(f.lon) && Math.abs(f.lat) <= 90 && Math.abs(f.lon) <= 180;

export function focusOnMap(f: MapFocus, now = Date.now()): boolean {
  if (!valid(f)) return false;
  pending = { focus: f, at: now };
  listeners.forEach((l) => l(f));
  return true;
}

/**
 * Suscribe a los pedidos de una ciudad (el mapa de esa ciudad) o de todas (`null`: el planificador, para ir al paso
 * de la ciudad). Devuelve la función para desuscribirse.
 */
export function onMapFocus(city: string | null, l: Listener, now = Date.now()): () => void {
  const own: Listener = (f) => {
    if (city !== null && f.city !== city) return;
    if (city !== null) pending = null; // ya lo tomó su mapa
    l(f);
  };
  listeners.add(own);
  if (city !== null && pending && pending.focus.city === city && now - pending.at < PENDING_MS) {
    const f = pending.focus;
    pending = null;
    l(f);
  }
  return () => { listeners.delete(own); };
}

export const _reset = () => { listeners.clear(); pending = null; };
