// Checkout (Pantalla 5): resumen por rubro, reparto por persona y calendario día por día con lo que eligió el
// usuario. Funciones puras en centavos enteros.
import type { Totals } from "@/lib/cart";
import type { Leg } from "@/lib/flights";
import type { FlightOffer, ItineraryPayload } from "@/lib/types";

// Igual que el motor (resto mayor): las primeras personas absorben los centavos sobrantes.
export function splitPerPax(totalMinor: number, pax: number): number[] {
  const base = Math.floor(totalMinor / pax);
  const rest = totalMinor - base * pax;
  return Array.from({ length: pax }, (_, i) => base + (i < rest ? 1 : 0));
}

export type Rubro = { key: string; label: string; minor: number };

// Vuelos (ida + vuelta) e interconexiones por separado; el resto sale de las categorías del carrito.
export function rubros(t: Totals, legs: Leg[], flightCost: (leg: Leg) => number): Rubro[] {
  const inter = legs.filter((l) => l.from !== "HOME" && l.to !== "HOME").reduce((a, l) => a + flightCost(l), 0);
  return [
    { key: "vuelos", label: "Vuelos (ida y vuelta)", minor: (t.byCategory.vuelos ?? 0) - inter },
    ...(legs.length > 2 ? [{ key: "interconexiones", label: "Interconexiones", minor: inter }] : []),
    { key: "alojamiento", label: "Alojamiento", minor: t.byCategory.alojamiento ?? 0 },
    { key: "actividades", label: "Actividades", minor: t.byCategory.actividades ?? 0 },
    { key: "transporte", label: "Movilidad", minor: t.byCategory.transporte ?? 0 },
  ];
}

// Señales del día según los horarios de los vuelos (horas locales sin zona, como las da el motor).
export type DayTag = { kind: "transfer" | "last_usable" | "drop_off"; text: string };

export type Day = {
  index: number; // Día 1, 2, … (nunca 0)
  date: string;
  flights: FlightOffer[];
  sleep: { city: string; lodging: string } | "vuelo" | null; // null = ya en casa
  activities: ItineraryPayload["stays"][number]["activities"];
  tags: DayTag[];
};

export const LATE_ARRIVAL_HOUR = 18; // llega después: el día se va en el traslado
export const LATE_DEPARTURE_HOUR = 19; // sale después: el día todavía se aprovecha
// El alojamiento no informa su horario de check-in: se usa el habitual y se aclara que hay que confirmarlo.
export const USUAL_CHECKIN_HOUR = 15;
export const DROP_OFF_MARGIN_H = 2; // llegar con menos margen que esto antes del check-in no amerita sugerencia

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Hora decimal de un "YYYY-MM-DDTHH:MM…"; null si el dato no tiene ese formato (la etiqueta simplemente no aparece).
export function hourOf(iso: string | null | undefined): number | null {
  const m = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)/.exec(iso ?? "");
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}
const hhmm = (iso: string) => iso.slice(11, 16);
const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;

type Stay = Pick<ItineraryPayload["stays"][number], "city" | "check_in" | "check_out">;

// Llegadas que abren una estadía y salidas que la cierran, con el último vuelo del día si hubiera más de uno.
export function dayTags(date: string, flights: FlightOffer[], stays: Stay[], cityName: (c: string) => string): DayTag[] {
  const tags: DayTag[] = [];
  // Si la línea de cambio de fecha deja la llegada "antes" de la salida, cuenta el día en que se viaja.
  const arrival = flights.filter((f) => hourOf(f.arrive_at) !== null
    && (f.arrive_at.slice(0, 10) > (f.depart_at?.slice(0, 10) ?? "") ? f.arrive_at.slice(0, 10) : f.depart_at?.slice(0, 10)) === date)
    .sort((a, b) => a.arrive_at.localeCompare(b.arrive_at)).at(-1);
  if (arrival && stays.some((s) => s.check_in === date)) {
    const h = hourOf(arrival.arrive_at)!;
    if (h >= LATE_ARRIVAL_HOUR) tags.push({ kind: "transfer", text: "Día de traslado · solo alojamiento" });
    else if (h <= USUAL_CHECKIN_HOUR - DROP_OFF_MARGIN_H) tags.push({ kind: "drop_off", text:
      `Llegás a las ${hhmm(arrival.arrive_at)} y el check-in suele ser desde las ${pad(USUAL_CHECKIN_HOUR)}: ` +
      "tiempo libre para dejar el equipaje en el alojamiento (drop-off) y salir a recorrer." });
  }
  const departure = flights.filter((f) => f.depart_at?.slice(0, 10) === date && hourOf(f.depart_at) !== null)
    .sort((a, b) => a.depart_at.localeCompare(b.depart_at))[0];
  const leaving = stays.find((s) => s.check_out === date);
  if (departure && leaving && hourOf(departure.depart_at)! >= LATE_DEPARTURE_HOUR) {
    tags.push({ kind: "last_usable", text: `Último día aprovechable en ${cityName(leaving.city)}: el vuelo sale a las ${hhmm(departure.depart_at)}` });
  }
  return tags;
}

const nextDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

const MAX_DAYS = 120; // tope defensivo: un dato corrupto nunca arma un calendario infinito

export function timeline(it: ItineraryPayload, flights: FlightOffer[], lodgingName: (city: string) => string,
  cityName: (city: string) => string = (c) => c): Day[] {
  const dates = flights.flatMap((f) => [f.depart_at?.slice(0, 10), f.arrive_at?.slice(0, 10)])
    .concat(it.stays.flatMap((s) => [s.check_in, s.check_out])).filter((d) => ISO_DATE.test(d ?? "")).sort();
  // El viaje empieza el día que sale el primer vuelo: una llegada con fecha anterior (línea de cambio de fecha) no
  // agrega un día previo a la salida. Sin vuelos, la primera fecha conocida.
  const departs = flights.map((f) => f.depart_at?.slice(0, 10)).filter((d) => ISO_DATE.test(d ?? "")).sort();
  const days: Day[] = [];
  for (let d = departs[0] ?? dates[0]; d && d <= dates[dates.length - 1] && days.length < MAX_DAYS; d = nextDay(d)) {
    const stay = it.stays.find((s) => s.check_in <= d && d < s.check_out); // fechas ISO: comparan como texto
    const out = flights.filter((f) => f.depart_at?.slice(0, 10) === d);
    const overnight = out.some((f) => (f.arrive_at?.slice(0, 10) ?? "") > d);
    days.push({
      index: days.length + 1,
      date: d,
      flights: out,
      sleep: stay ? { city: stay.city, lodging: lodgingName(stay.city) } : overnight ? "vuelo" : null,
      activities: it.stays.flatMap((s) => s.activities).filter((a) => a.date === d),
      tags: dayTags(d, flights, it.stays, cityName),
    });
  }
  return days;
}

// Agrupado por destino (región común y proximidad de Gestalt; "chunking"): la persona piensa el viaje como "los días
// en Orlando, después Nueva York". Dentro de cada grupo, los días en orden y numerados de punta a punta del viaje.
// Un día va a la ciudad donde duerme; si duerme en el avión o ya en casa, a la ciudad que deja ese día; si no hay
// ninguna (salida o regreso), a un grupo "en tránsito".
const DAY_MS = 86_400_000;
export function nightsBetween(checkIn: string, checkOut: string): number {
  const n = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type DayGroup = { key: string; city: string | null; checkIn?: string; checkOut?: string; nights?: number; days: Day[] };

export function groupByStay(days: Day[], stays: Stay[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const d of days) {
    const city = typeof d.sleep === "object" && d.sleep ? d.sleep.city : stays.find((s) => s.check_out === d.date)?.city ?? null;
    const last = groups.at(-1);
    if (last && last.city === city) { last.days.push(d); continue; }
    const stay = city ? stays.find((s) => s.city === city && s.check_in <= d.date && d.date <= s.check_out) : undefined;
    groups.push({
      key: `${city ?? "transit"}-${d.date}`, city, days: [d],
      ...(stay && { checkIn: stay.check_in, checkOut: stay.check_out, nights: nightsBetween(stay.check_in, stay.check_out) }),
    });
  }
  return groups;
}
