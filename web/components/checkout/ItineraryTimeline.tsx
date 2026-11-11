import { BedDouble, Clock, House, Luggage, MapPin, Moon, Plane, Sunset, Ticket, type LucideIcon } from "lucide-react";
import { cityByCode } from "@/lib/cities";
import type { DayGroup, DayTag } from "@/lib/checkout";
import { airlineName, dayOffset, fmtDay, fmtDayOffset, fmtDuration, fmtTime } from "@/lib/format";

const cityName = (code: string) => cityByCode(code)?.name ?? code;

const TAG_STYLE: Record<DayTag["kind"], string> = {
  transfer: "bg-slate-100 text-slate-700",
  last_usable: "bg-emerald-50 text-emerald-800",
  drop_off: "bg-amber-50 text-amber-900",
};
const TAG_ICON: Record<DayTag["kind"], LucideIcon> = { transfer: Luggage, last_usable: Sunset, drop_off: Clock };
const ICON = "mr-1.5 inline size-4 align-text-bottom";

// Línea de tiempo del itinerario: agrupada por destino (encabezado con check-in, check-out y noches) y conectada día
// por día (Día 1, 2, …). Sin datos no rompe: muestra un aviso en lugar del calendario.
export default function ItineraryTimeline({ groups }: { groups: DayGroup[] }) {
  if (groups.length === 0 || groups.every((g) => g.days.length === 0)) {
    return <p className="rounded-2xl bg-surface p-5 text-sm text-muted" data-testid="timeline-empty">
      Todavía no hay fechas para armar el calendario.
    </p>;
  }
  const total = groups.reduce((a, g) => a + g.days.length, 0);
  return (
    <div className="space-y-8" data-testid="timeline" aria-label={`Itinerario de ${total} días`}>
      {groups.map((g) => (
        <section key={g.key} className="break-inside-avoid" aria-label={g.city ? cityName(g.city) : "En tránsito"}
          data-testid={`timeline-group-${g.city ?? "transit"}`}>
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="font-display text-lg font-bold text-ink">
              {g.city ? <MapPin aria-hidden className={`${ICON} text-accent`} /> : <Plane aria-hidden className={`${ICON} text-accent`} />}
              {g.city ? cityName(g.city) : "En tránsito"}
            </h3>
            {g.checkIn && g.checkOut && !!g.nights && (
              <p className="text-sm text-muted" data-testid="stay-summary">
                Check-in: {fmtDay(g.checkIn)} · Check-out: {fmtDay(g.checkOut)}{" "}
                <span className="font-semibold text-ink">({g.nights} {g.nights === 1 ? "noche" : "noches"})</span>
              </p>
            )}
          </header>
          <ol className="relative space-y-3 border-l-2 border-line pl-6">
            {g.days.map((d) => (
              <li key={d.date} className="relative break-inside-avoid">
                <span className={`absolute -left-[33px] top-5 size-4 rounded-full ring-4 ring-white transition-all duration-300 ${
                  d.flights.length ? "bg-accent" : d.activities.length ? "bg-ink" : "bg-line"}`} aria-hidden />
                <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-display text-base font-extrabold text-ink">
                      <span className="mr-2 text-accent">Día {d.index}</span>
                      <span className="sr-only">de {total}, </span>{fmtDay(d.date)}
                    </p>
                    <p className="text-xs text-muted">
                      {d.sleep === "vuelo" ? <><Moon aria-hidden className={ICON} />Noche en vuelo</>
                        : d.sleep ? <><BedDouble aria-hidden className={ICON} />{d.sleep.lodging} · {cityName(d.sleep.city)}</>
                          : <><House aria-hidden className={ICON} />De vuelta en casa</>}
                    </p>
                  </div>
                  {d.tags.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Notas del día">
                      {d.tags.map((t) => {
                        const Icon = TAG_ICON[t.kind];
                        return (
                          <li key={t.kind} data-testid={`day-tag-${t.kind}`}
                            className={`rounded-xl px-2.5 py-1 text-xs font-medium ${TAG_STYLE[t.kind]}`}>
                            <Icon aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />{t.text}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {(d.flights.length > 0 || d.activities.length > 0) && (
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {d.flights.map((f) => (
                        <li key={f.id} className="text-ink">
                          <Plane aria-hidden className={`${ICON} text-accent`} />
                          {f.origin} {fmtTime(f.depart_at)} → {f.destination} {fmtTime(f.arrive_at)}
                          {dayOffset(f.depart_at, f.arrive_at) !== 0 && <sup className="text-accent">{fmtDayOffset(dayOffset(f.depart_at, f.arrive_at))}</sup>}
                          <span className="text-muted"> · {airlineName(f.carrier)}{f.duration_min ? ` · ${fmtDuration(f.duration_min)}` : ""}</span>
                        </li>
                      ))}
                      {d.activities.map((a) => (
                        <li key={a.name} className="text-ink"><Ticket aria-hidden className={`${ICON} text-accent`} />{a.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
