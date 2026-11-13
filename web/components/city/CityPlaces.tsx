"use client";

import { Map as MapIcon } from "lucide-react";
import { memo, useEffect, useState } from "react";
import ExternalIcon from "@/components/ui/ExternalIcon";
import Carousel from "@/components/ui/Carousel";
import MapButton from "@/components/ui/MapButton";
import { pointFocus } from "@/lib/mapTargets";
import { safeHref } from "@/lib/links";

// engine/app/providers/places.py::Place
export type Place = { id: string; name: string; kind: string; outdoor: boolean; lat: number; lon: number; link: string | null };

// Lugares reales para visitar (Wikidata, gratis). Son información: Wikidata no publica precios de entrada, así que no
// se suman al total. Mientras carga, si falla o si no hay lugares, la sección no se muestra.
export default memo(function CityPlaces({ city, cityName }: { city: string; cityName: string }) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/places?${new URLSearchParams({ city })}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { places?: Place[] } | null) => setPlaces(Array.isArray(d?.places) ? d.places : []))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [city]);

  if (!places?.length) return null;
  return (
    <section aria-labelledby={`places-${city}`} className="space-y-4 print:hidden" data-testid="city-places">
      <div>
        <h4 id={`places-${city}`} className="font-display text-lg font-bold text-ink"><MapIcon aria-hidden className="mr-1.5 inline size-5 align-text-bottom text-accent" />Lugares para conocer en {cityName}</h4>
        <p className="text-sm text-muted">Los más conocidos según Wikipedia. Entrada y horarios en cada sitio: no se suman al total.</p>
      </div>
      <Carousel label={`Lugares en ${cityName}`}>
        {places.map((p) => {
          const href = safeHref(p.link);
          return (
            <div role="listitem" key={p.id} className="flex flex-col rounded-2xl bg-white p-4 shadow-sm lift transition-colors duration-300" data-testid="city-place">
              <span className="w-fit rounded-full bg-surface px-2.5 py-0.5 text-xs font-bold text-muted">
                {p.kind} · {p.outdoor ? "al aire libre" : "bajo techo"}
              </span>
              <p className="mt-2 font-semibold text-ink">{p.name}</p>
              <MapButton focus={pointFocus(city, p.name, "place", p)} className="mt-2" />
              <p className="mt-auto pt-3 text-xs text-muted">Fuente: Wikidata</p>
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 text-sm font-semibold text-accent hover:underline">
                  Leer en Wikipedia <ExternalIcon />
                </a>
              )}
            </div>
          );
        })}
      </Carousel>
    </section>
  );
});
