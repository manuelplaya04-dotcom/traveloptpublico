import { cityByCode } from "@/lib/cities";
import { fmtDay } from "@/lib/format";
import type { Run } from "@/lib/types";

const REASONS: Record<string, string> = {
  "flight.too_many_stops": "Vuelos con más escalas que el máximo",
  "flight.departs_too_early": "Vuelos que salen antes de la hora mínima",
  "flight.arrives_too_late": "Vuelos que llegan después de la hora máxima",
  "flight.insufficient_seats": "Vuelos sin asientos para todo el grupo",
  "lodging.bathrooms": "Alojamientos con menos baños que el mínimo",
  "lodging.capacity": "Alojamientos sin capacidad para el grupo",
  "lodging.bedrooms": "Alojamientos con menos dormitorios que el mínimo",
  "lodging.min_nights": "Alojamientos con estadía mínima mayor a la planificada",
  "lodging.short_term_not_legal": "Alquileres temporarios no legales (p. ej. NYC Local Law 18)",
  "activity.weather_rain": "Actividades al aire libre descartadas por lluvia",
  "activity.weather_heat": "Actividades al aire libre descartadas por calor",
};
const GROUPS: [prefix: string, title: string][] = [["flight.", "Vuelos"], ["lodging.", "Alojamiento"], ["activity.", "Actividades"]];

const cityName = (code: string) => cityByCode(code)?.name ?? code;

// Tramo i de un recorrido [A, B, …]: 0 = ida a A, n = vuelta a casa, el resto = de una ciudad a la siguiente.
const legName = (i: number, cities: string[]) =>
  i === 0 ? `la ida a ${cityName(cities[0])}`
    : i >= cities.length ? `la vuelta desde ${cityName(cities[cities.length - 1])}`
      : `el tramo ${cityName(cities[i - 1])} → ${cityName(cities[i])}`;

// "ORL-NYC|2027-07-08|6-6" + "actividades_infactibles:ORL" → frase legible.
function skeletonText(id: string, why: string): string {
  const [order, date, nights] = id.split("|");
  const plan = order.split("-").map((c, i) => `${cityName(c)} ${nights?.split("-")[i]} noches`).join(" + ");
  const [code, city] = why.split(":");
  const legs = order.split("-");
  const reason = code === "actividades_infactibles"
    ? `no alcanzan los días para las actividades elegidas en ${cityName(city)}`
    : code === "sin_vuelo" && city?.startsWith("tramo_")
      ? `no encontramos vuelos para ${legName(Number(city.slice(6)), legs)}`
      : why;
  return `Primera noche ${fmtDay(date)} · ${plan}: ${reason}.`;
}

// Explicabilidad: qué quedó afuera y por qué. Plegado cuando hay resultado; abierto si no hay solución.
export default function Funnel({ diagnostics, defaultOpen = false }: {
  diagnostics: NonNullable<Run["summary"]["diagnostics"]>; defaultOpen?: boolean;
}) {
  const rows = Object.entries(diagnostics.rejections);
  const skel = Object.entries(diagnostics.infeasible_skeletons);
  const total = rows.reduce((a, [, ids]) => a + ids.length, 0);

  return (
    <details open={defaultOpen} className="group rounded-3xl bg-surface p-6 sm:p-8" data-testid="funnel">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <span>
          <span className="block font-display text-xl font-bold text-ink">¿Qué quedó afuera?</span>
          <span className="mt-1 block text-sm text-muted">
            {total} opciones descartadas por tus condiciones{skel.length ? ` · ${skel.length} combinaciones de fechas imposibles` : ""}
          </span>
        </span>
        <span className="text-xl text-muted transition group-open:rotate-180" aria-hidden>⌄</span>
      </summary>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {GROUPS.map(([prefix, title]) => {
          const items = rows.filter(([r]) => r.startsWith(prefix));
          if (!items.length) return null;
          return (
            <div key={prefix}>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-accent">{title}</h4>
              <ul className="mt-3 space-y-2 text-sm">
                {items.map(([reason, ids]) => (
                  <li key={reason} className="flex justify-between gap-3">
                    <span className="text-muted">{REASONS[reason] ?? reason}</span>
                    <span className="font-semibold text-ink">{ids.length}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {skel.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-accent">Combinaciones de fechas descartadas</h4>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            {skel.map(([id, why]) => <li key={id}>{skeletonText(id, why)}</li>)}
          </ul>
        </div>
      )}
    </details>
  );
}
