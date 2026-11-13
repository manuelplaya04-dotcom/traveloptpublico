import type { ItineraryPayload } from "@/lib/types";

// Exportación a calendario (iCalendar, RFC 5545) generada en el navegador: no sale ningún dato del dispositivo.
// Vuelos con hora local del aeropuerto (horario "flotante", sin zona: igual que el modelo del motor, así el calendario
// muestra la misma hora que el boarding pass) y estadías como eventos de día completo (check-in a check-out).

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const local = (iso: string) => iso.slice(0, 19).replace(/[-:]/g, ""); // 2027-07-08T09:00:00 -> 20270708T090000
const day = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

// Líneas de más de 75 octetos se pliegan (RFC 5545 §3.1): CRLF + espacio.
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ""; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const utc = (iso: string | null | undefined): string | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z" : null;
};

export function buildIcs(p: ItineraryPayload, cityName: (code: string) => string, stamp: Date = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const uid = (k: string) => `${k}-${p.skeleton_id}@travelopt`;
  const events: string[][] = [
    ...p.flights.map(({ offer: f, leg }) => [
      `UID:${uid(`vuelo-${leg}`)}`, `DTSTAMP:${dtstamp}`,
      // Con instantes reales el evento dura lo que el vuelo en cualquier calendario. Sin ellos, hora flotante (local):
      // hacia el oeste la llegada puede quedar "antes" de la salida.
      ...(utc(f.depart_utc) && utc(f.arrive_utc)
        ? [`DTSTART:${utc(f.depart_utc)}`, `DTEND:${utc(f.arrive_utc)}`]
        : [`DTSTART:${local(f.depart_at)}`, `DTEND:${local(f.arrive_at)}`]),
      `SUMMARY:${esc(`Vuelo ${f.carrier} ${f.origin} → ${f.destination}`)}`,
      `DESCRIPTION:${esc(`${f.stops === 0 ? "Directo" : `${f.stops} escala(s)`}. Sale ${f.depart_at.slice(11, 16)} y llega ${f.arrive_at.slice(11, 16)}, horarios locales de cada aeropuerto.`)}`,
      `LOCATION:${esc(f.origin)}`,
    ]),
    // sin alojamiento cotizado no hay reserva que agendar (la persona ya tiene la suya)
    ...p.stays.filter((s) => s.lodging).map((s) => [
      `UID:${uid(`estadia-${s.city}-${s.check_in}`)}`, `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${day(s.check_in)}`, `DTEND;VALUE=DATE:${day(s.check_out)}`,
      `SUMMARY:${esc(`Alojamiento: ${cityName(s.city)} · ${s.lodging?.name}`)}`,
      `DESCRIPTION:${esc(`${s.nights} noches. Check-in ${s.check_in}, check-out ${s.check_out}.`)}`,
    ]),
  ];
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TravelOpt//Itinerario//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
