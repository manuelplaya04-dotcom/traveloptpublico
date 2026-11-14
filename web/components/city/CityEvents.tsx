"use client";

import { memo, useEffect, useState } from "react";
import Carousel from "@/components/ui/Carousel";
import MapButton from "@/components/ui/MapButton";
import { pointFocus, venueFocus } from "@/lib/mapTargets";
import CardInfo from "@/components/ui/CardInfo";
import ExternalIcon from "@/components/ui/ExternalIcon";
import { Ticket } from "lucide-react";
import { fmtDay } from "@/lib/format";
import { safeHref } from "@/lib/links";
import { useMoney } from "@/components/money/MoneyProvider";

// engine/app/providers/events.py::CityEvent
export type CityEvent = {
  id: string; source: "ticketmaster" | "google_events"; name: string; date: string; time: string | null;
  venue: string | null; category: string | null; price_min_minor: number | null; price_max_minor: number | null;
  link: string | null; fetched_at: string;
  lat?: number | null; lon?: number | null; // ubicación del recinto, si la fuente la publica (Ticketmaster)
};

const SOURCE = { ticketmaster: "Ticketmaster", google_events: "Google" } as const;

// Eventos reales durante la estadía (Ticketmaster + Google Events pre-cargado). Es información para elegir: no entra
// al total. Degradación elegante: mientras carga, si falla o si no hay eventos, la sección no se muestra.
export default memo(function CityEvents({ city, cityName, start, end }: {
  city: string; cityName: string; start: string; end: string;
}) {
  const money = useMoney(); // precios en la moneda elegida (USD o pesos)
  const [events, setEvents] = useState<CityEvent[] | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/events?${new URLSearchParams({ city, start, end })}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { events?: CityEvent[] } | null) => setEvents(Array.isArray(d?.events) ? d.events : []))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [city, start, end]);

  if (!events?.length) return null;
  return (
    <section aria-labelledby={`events-${city}`} className="space-y-4 print:hidden" data-testid="city-events">
      <div>
        <h4 id={`events-${city}`} className="font-display text-lg font-bold text-ink"><Ticket aria-hidden className="mr-1.5 inline size-5 align-text-bottom text-accent" />Eventos en {cityName} durante tu estadía</h4>
        <p className="text-sm text-muted">Partidos, recitales, obras y más. No se suman al total: elegí y comprá en la fuente.</p>
      </div>
      <Carousel label={`Eventos en ${cityName}`}>
        {events.map((e) => {
          const href = safeHref(e.link);
          const price = e.price_min_minor !== null
            ? `Desde ${money(e.price_min_minor)}${e.price_max_minor && e.price_max_minor > e.price_min_minor ? ` hasta ${money(e.price_max_minor)}` : ""}`
            : null;
          return (
            <div role="listitem" key={e.id} className="flex flex-col rounded-2xl bg-white p-4 shadow-sm lift transition-colors duration-300" data-testid="city-event">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-bold text-muted">
                  {fmtDay(e.date)}{e.time ? ` · ${e.time}` : ""}
                </span>
                <CardInfo provider={e.source} fetchedAt={e.fetched_at} />
              </div>
              <p className="mt-2 font-semibold text-ink">{e.name}</p>
              <p className="text-xs text-muted">{[e.venue, e.category].filter(Boolean).join(" · ")}</p>
              {price && <p className="mt-1 text-sm font-semibold text-ink">{price}</p>}
              <MapButton focus={pointFocus(city, e.venue ?? e.name, "venue", e) ?? venueFocus(city, e.venue)} className="mt-2" />
              <p className="mt-auto pt-3 text-xs text-muted">Fuente: {SOURCE[e.source]}</p>
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer"
                  className="mt-1 text-sm font-semibold text-accent hover:underline">Ver entradas <ExternalIcon /></a>
              )}
            </div>
          );
        })}
      </Carousel>
    </section>
  );
});
