import { memo } from "react";
import { Rocket, TriangleAlert } from "lucide-react";
import ExternalIcon from "@/components/ui/ExternalIcon";
import { CompareLinks, PriceTags, Sparkline, VsAverage } from "@/components/ui/PriceSignals";
import { flightCompareLinks, safeHref } from "@/lib/links";
import type { FlightOption } from "@/lib/flights";
import type { PriceTag } from "@/lib/market";
import { airlineName, dayOffset, fmtDay, fmtDayOffset, fmtDuration, fmtTime, REJECTION_LABEL, sourceName } from "@/lib/format";
import { fmtMinor } from "@/lib/money";
import { ADVICE_LABEL, ADVICE_STYLE, type Advice } from "@/lib/priceAdvice";
import CardInfo from "@/components/ui/CardInfo";
import MapButton from "@/components/ui/MapButton";
import type { MapFocus } from "@/lib/mapFocus";

export type FlightSignals = { tags: PriceTag[]; diff?: number; trend: { date: string; price: number }[] };

// memo: al elegir otro vuelo solo se vuelven a dibujar las dos tarjetas que cambian de estado (onSelect es estable).
export default memo(function FlightCard({ option, pax, bagsPerPax, optimal, selected, signals, advice, mapFocus, onSelect }: {
  option: FlightOption; pax: number; bagsPerPax: number; optimal: boolean; selected: boolean; signals?: FlightSignals;
  advice?: Advice; // asesor de momento óptimo (historial de 30 días); ausente en cold start
  mapFocus?: MapFocus | null; // aeropuerto en el mapa de una ciudad del viaje
  onSelect: (o: FlightOption) => void;
}) {
  const { offer: f, costMinor, rejection } = option;
  const href = safeHref(f.deeplink);
  const offset = fmtDayOffset(dayOffset(f.depart_at, f.arrive_at));
  const duration = fmtDuration(f.duration_min);
  const extraBags = Math.max(0, bagsPerPax - f.included_bags);

  return (
    <article
      data-testid={`flight-${f.id}`}
      className={`flex w-full flex-col rounded-3xl bg-white p-6 lift transition-colors duration-300 ${
        rejection ? "opacity-60 shadow-sm"
          : selected ? "bg-accent/5 shadow-lg ring-2 ring-accent" : "shadow-sm"}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">{airlineName(f.carrier)}</p>
          <p className="text-xs text-muted">{[sourceName(f.deeplink), fmtDay(f.depart_at)].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="flex items-center gap-1">
          {optimal && !rejection && (
            <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">Óptimo</span>
          )}
          <CardInfo provider={f.provider} fetchedAt={f.fetched_at} />
        </span>
      </header>
      {!rejection && advice && (
        <p className={`mt-3 w-fit rounded-full px-3 py-1 text-xs font-bold ring-1 ${ADVICE_STYLE[advice]}`} data-testid="price-advice"
          title="Comparado con los precios reales de esta ruta y fecha en los últimos 30 días">
          {advice === "opportunity" && <Rocket aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />}
          {advice === "wait" && <TriangleAlert aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />}
          {ADVICE_LABEL[advice]}
        </p>
      )}
      {!rejection && signals && signals.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2"><PriceTags tags={signals.tags} /></div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <div>
          <p className="font-display text-2xl font-extrabold text-ink">{fmtTime(f.depart_at)}</p>
          <p className="text-xs font-medium text-muted">{f.origin}</p>
        </div>
        <div className="flex flex-1 flex-col items-center">
          <span className="whitespace-nowrap text-xs text-muted">{f.stops === 0 ? "Directo" : `${f.stops} escala${f.stops > 1 ? "s" : ""}`}{duration && ` · ${duration}`}</span>
          <span className="my-1 h-px w-full bg-line" aria-hidden />
        </div>
        <div className="text-right">
          <p className="font-display text-2xl font-extrabold text-ink">
            {fmtTime(f.arrive_at)}{offset && <sup className="ml-0.5 text-xs text-accent">{offset}</sup>}
          </p>
          <p className="text-xs font-medium text-muted">{f.destination}</p>
        </div>
      </div>

      <MapButton focus={mapFocus ?? null} className="mt-3" />

      <p className="mt-4 mb-6 text-xs text-muted">
        {f.included_bags > 0 ? `${f.included_bags} valija incluida por persona`
          : extraBags > 0 && f.bag_fee_known === false ? "Valija: costo no incluido (depende de la tarifa; ver en la aerolínea)"
          : extraBags > 0 ? `Valija: +${fmtMinor(f.bag_fee_minor)} por persona` : "Sin valija despachada"}
      </p>

      <footer className="mt-auto flex flex-col gap-4 border-t border-line pt-4">
        <div>
          <p className="whitespace-nowrap font-display text-2xl font-extrabold text-ink" data-testid="flight-price">{fmtMinor(costMinor)}</p>
          <p className="text-xs text-muted">{pax} pasajeros · {fmtMinor(Math.round(costMinor / pax))} c/u</p>
          {!rejection && signals && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <VsAverage diff={signals.diff} />
              <Sparkline points={signals.trend} current={f.depart_at.slice(0, 10)} />
            </div>
          )}
        </div>
        {rejection ? (
          <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-center text-sm font-medium text-red-700">{REJECTION_LABEL[rejection] ?? rejection}</p>
        ) : (
          <button type="button" onClick={() => onSelect(option)} disabled={selected} aria-pressed={selected}
            className={`w-full rounded-full px-5 py-3 text-sm font-semibold transition ${
              selected ? "bg-accent-soft text-accent" : "bg-accent text-white hover:bg-accent-hover"}`}>
            {selected ? "✓ Seleccionado" : "Seleccionar"}
          </button>
        )}
      </footer>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="mt-3 text-xs font-medium text-accent hover:underline">
          Ver oferta <ExternalIcon />
        </a>
      )}
      {!rejection && <CompareLinks links={flightCompareLinks(f, pax)} />}
    </article>
  );
});
