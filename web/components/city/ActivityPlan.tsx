import { memo } from "react";
import { safeHref } from "@/lib/links";
import { MapPin } from "lucide-react";
import ExternalIcon from "@/components/ui/ExternalIcon";
import WeatherIcon from "@/components/ui/WeatherIcon";
import { fmtDay, stayDays, weatherKind, type WeatherKind } from "@/lib/format";
import { estimateTrip, fmtTrip, hasCoords, type Trip } from "@/lib/geo";
import { activityPriceHint, activityPriceLabel } from "@/lib/activityPrice";
import { useMoney } from "@/components/money/MoneyProvider";
import type { ItineraryPayload, WeatherDay } from "@/lib/types";

type Stay = ItineraryPayload["stays"][number];

// Fondo de la fila según el clima: los días de lluvia fuerte se ven de un vistazo.
const ROW: Record<WeatherKind, string> = {
  storm: "bg-orange-50 shadow-sm ring-1 ring-orange-300",
  cloud: "bg-white shadow-sm",
  sun: "bg-white shadow-sm",
};

// Esquema día por día de la estadía: lo que agendó el motor (imperdibles, con precio y link de compra) y por qué
// los demás días quedan libres (viaje o lluvia).
export default memo(function ActivityPlan({ stay, lodging, weather, maxRain, travelDaysFree, roads }: {
  stay: Stay; lodging: { name: string; lat?: number | null; lon?: number | null } | null; weather: WeatherDay[]; maxRain: number;
  travelDaysFree: boolean; roads?: Map<string, Trip>; // rutas reales por calle (OSRM) por nombre de actividad
}) {
  const money = useMoney(); // precios en la moneda elegida (USD o pesos)
  // Distancia desde el alojamiento elegido a cada actividad: ruta real si la hay; si no, estimación en línea recta.
  const tripTo = (a: { name: string; lat?: number | null; lon?: number | null }) =>
    roads?.get(a.name) ?? (hasCoords(lodging) && hasCoords(a) ? estimateTrip(lodging, a) : undefined);
  // Igual que engine/app/optimizer/skeletons.py::usable_days: sin días de viaje libres, el check-out también cuenta.
  const days = travelDaysFree ? stayDays(stay.check_in, stay.check_out) : [...stayDays(stay.check_in, stay.check_out), stay.check_out];
  return (
    <section className="space-y-4">
      <h4 className="font-display text-lg font-bold text-ink">Tu calendario optimizado</h4>
      <ol className="space-y-2">
        {days.map((d) => {
          const acts = stay.activities.filter((a) => a.date === d);
          const w = weather.find((x) => x.date === d);
          const kind = w ? weatherKind(w.heavy_rain_prob, maxRain) : undefined;
          const note = d === stay.check_in && travelDaysFree ? "Día de llegada"
            : w && w.heavy_rain_prob > maxRain ? `Lluvia fuerte probable (${Math.round(w.heavy_rain_prob * 100)}%): sin actividades al aire libre`
              : "Día libre";
          return (
            <li key={d} data-weather={kind}
              className={`flex flex-col gap-2 rounded-2xl p-4 sm:flex-row sm:items-center ${kind ? ROW[kind] : "bg-white shadow-sm"}`}>
              <span className="flex w-36 shrink-0 items-center gap-2 text-sm font-semibold text-ink">
                {kind ? <WeatherIcon kind={kind} /> : <span aria-hidden className="text-lg">·</span>}
                {fmtDay(d)}
                {w && <span className={`text-xs font-medium ${kind === "storm" ? "text-orange-700" : "text-muted"}`}>{Math.round(w.tmax_c)}°</span>}
              </span>
              {acts.length === 0 ? (
                <span className={`text-sm ${kind === "storm" ? "font-medium text-orange-800" : "text-muted"}`}>{note}</span>
              ) : (
                <ul className="flex flex-1 flex-col gap-2">
                  {acts.map((a) => {
                    const href = safeHref(a.deeplink);
                    const trip = tripTo(a); // una vez por actividad (antes se recalculaba en cada uso)
                    return (
                      <li key={a.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <span className="text-sm text-ink">
                          {a.name}
                          <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">En tu itinerario</span>
                          {a.weather_verified === false && (
                            <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800"
                              title="No pudimos consultar el clima de ese día" data-testid="weather-unverified">Clima sin verificar</span>
                          )}
                        </span>
                        {trip && (
                          <span className="basis-full text-xs text-muted" data-testid="activity-distance"
                            title={trip.estimated ? "Estimado: línea recta + 30% por calles, a velocidad media"
                              : "Ruta real por calle (OSRM · OpenStreetMap)"}>
                            <MapPin aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />{fmtTrip(trip)} desde el alojamiento{trip.estimated ? " (estimado)" : " (ruta por calle)"}
                          </span>
                        )}
                        <span className="flex items-center gap-3 text-sm">
                          <span className="whitespace-nowrap font-semibold text-ink" title={activityPriceHint(a.price_source, a.price_date_based)}>
                            {a.price_source === "box_office" || a.price_source === "curated"
                              ? activityPriceLabel(a.cost_minor, a.price_source, a.price_date_based, money) : money(a.cost_minor)}
                          </span>
                          {href && <a href={href} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-xs font-medium text-accent hover:underline">Comprar <ExternalIcon /></a>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
});
