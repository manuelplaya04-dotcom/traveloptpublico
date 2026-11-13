import { memo } from "react";
import { Car, CarTaxiFront, Plane } from "lucide-react";
import ExternalIcon from "@/components/ui/ExternalIcon";
import { safeHref } from "@/lib/links";
import { Widget } from "@/components/city/WeatherWidget";
import { TRANSPORT_MODE } from "@/lib/format";
import { fmtMinor } from "@/lib/money";
import { fmtTrip, type Trip } from "@/lib/geo";
import type { TransportQuote } from "@/lib/types";

// Movilidad local: la cotización que usó el motor (el costo viene del itinerario, ya con impuestos).
export default memo(function MobilityWidget({ quotes, costMinor, nights, transfers = [] }: {
  quotes: TransportQuote[]; costMinor: number; nights: number;
  transfers?: { airport: string; trip: Trip }[]; // alojamiento → aeropuerto, ruta real por calle (solo logística)
}) {
  return (
    <Widget title="Movilidad" subtitle="Incluida en tu total">
      {transfers.length > 0 && (
        <div className="mb-4 rounded-2xl bg-surface p-4" data-testid="airport-transfers">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Del alojamiento al aeropuerto (en auto)</p>
          <ul className="mt-2 space-y-1 text-sm">
            {transfers.map((t) => (
              <li key={t.airport} className="flex justify-between gap-3">
                <span className="text-ink"><Plane aria-hidden className="mr-1 inline size-4 align-text-bottom text-accent" />{t.airport}</span>
                <span className="text-muted">{fmtTrip(t.trip)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Ruta real por calle (OSRM · OpenStreetMap), sin tránsito. Solo tiempo y distancia.</p>
        </div>
      )}
      {quotes.length === 0 ? (
        <p className="text-sm text-muted">Sin transporte cotizado para esta ciudad.</p>
      ) : (
        <ul className="space-y-3">
          {quotes.map((q) => {
            const href = safeHref(q.deeplink);
            const detail = q.mode === "car_rental"
              ? `${nights} días × ${fmtMinor(q.per_day_minor)}${q.fixed_minor ? ` + ${fmtMinor(q.fixed_minor)} fijo` : ""}`
              : `${q.trips} viajes × ${fmtMinor(q.per_trip_minor)}`;
            return (
              <li key={q.id} className="flex items-center gap-4 rounded-2xl bg-surface p-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-xl" aria-hidden>
                  {q.mode === "car_rental" ? <Car className="size-5" /> : <CarTaxiFront className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{TRANSPORT_MODE[q.mode] ?? q.mode}</p>
                  <p className="text-xs text-muted">{detail}</p>
                  {href && <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-accent hover:underline">Ver cotización <ExternalIcon /></a>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {quotes.length > 0 && (
        <p className="mt-4 flex items-baseline justify-between border-t border-line pt-3 text-sm">
          <span className="text-muted">Total movilidad (con impuestos)</span>
          <span className="font-display text-lg font-extrabold text-ink" data-testid="mobility-total">{fmtMinor(costMinor)}</span>
        </p>
      )}
      <p className="mt-3 text-xs text-muted">Por ahora cotizamos una opción por ciudad.</p>
    </Widget>
  );
});
