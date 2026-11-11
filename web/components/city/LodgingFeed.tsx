"use client";

import { memo, useCallback, useMemo } from "react";
import { useCart } from "@/components/cart/CartContext";
import { CompareLinks, PriceTags, Stars, VsAverage } from "@/components/ui/PriceSignals";
import Rejected from "@/components/ui/Rejected";
import { isDemoProvider, REJECTION_LABEL } from "@/lib/format";
import { lodgingCompareLinks, safeHref } from "@/lib/links";
import { photoSrc } from "@/lib/photo";
import { groupStats, priceTags, vsAverage, type PriceTag } from "@/lib/market";
import { fmtMinor } from "@/lib/money";
import type { LodgingOption } from "@/lib/types";
import Carousel from "@/components/ui/Carousel";
import { ChefHat, Hotel, House } from "lucide-react";
import CardInfo from "@/components/ui/CardInfo";
import ExternalIcon from "@/components/ui/ExternalIcon";
import MapButton from "@/components/ui/MapButton";
import { pointFocus } from "@/lib/mapTargets";

export const lodgingSlot = (city: string) => `lodging:${city}`;

const unitsText = (o: LodgingOption) =>
  o.units.map((u) => `${u.qty}× ${u.unit_type} · ${u.bedrooms} dorm. · ${u.bathrooms} baño${u.bathrooms === 1 ? "" : "s"}`).join(" + ");

// Proveedores que no informan cuántas unidades quedan (Google Hotels): ahí no hay "Últimos lugares".
const UNITS_UNKNOWN = new Set(["serpapi_google_hotels"]);

// La combinación elegida se lleva todas las unidades que quedan de algún tipo: dato del proveedor, no inventado.
const lastUnits = (o: LodgingOption) =>
  !UNITS_UNKNOWN.has(o.provider) && o.units.some((u) => u.available > 0 && u.qty >= u.available);

// Aclaración cuando los baños no los informa el proveedor (ver bathrooms_source en el modelo del motor).
function bathsHint(o: LodgingOption): string | undefined {
  if (o.units.some((u) => u.bathrooms_source === "inferred_per_room")) return "Baños estimados: 1 por habitación (el proveedor no lo informa)";
  if (o.units.some((u) => u.bathrooms_source === "inferred_minimum")) return "El anuncio no informa baños: contamos solo 1, el mínimo seguro";
  return undefined;
}

// Feed de alojamiento de una estadía: alternativas calculadas por el motor (mejor combinación de unidades de cada
// propiedad), de la más barata a la más cara. La óptima viene preseleccionada; "Seleccionar" mueve el subtotal.
export default function LodgingFeed({ city, cityName, nights, checkIn, checkOut, pax, options }: {
  city: string; cityName: string; nights: number; checkIn: string; checkOut: string; pax: number; options: LodgingOption[];
}) {
  const { cart, choose } = useCart();
  const slot = lodgingSlot(city);
  const chosen = cart.selected[slot]?.id ?? cart.optimal[slot]?.id;
  const optimalId = cart.optimal[slot]?.id;

  // Derivados que no dependen del carrito: se calculan una vez por estadía.
  const { eligible, rejected, tags, diffs } = useMemo(() => {
    const ok = options.filter((o) => !o.rejection).sort((a, b) => (a.cost_minor ?? 0) - (b.cost_minor ?? 0));
    const stats = groupStats(ok.map((o) => o.cost_minor ?? 0));
    return {
      eligible: ok,
      rejected: options.filter((o) => o.rejection),
      tags: new Map(ok.map((o) => [o.offer_id, priceTags(o.cost_minor ?? 0, stats, lastUnits(o), ok.length)])),
      diffs: new Map(ok.map((o) => [o.offer_id, vsAverage(o.cost_minor ?? 0, stats)])),
    };
  }, [options]);
  const compare = useMemo(() => lodgingCompareLinks(cityName, checkIn, checkOut, pax), [cityName, checkIn, checkOut, pax]);
  const onSelect = useCallback((o: LodgingOption) =>
    choose(slot, { id: o.offer_id, label: o.name, category: "alojamiento", costMinor: o.cost_minor ?? 0 }), [choose, slot]);

  const grid = (group: LodgingOption[]) => (
    <Carousel label={`Alojamientos en ${cityName}`} testId="lodging-carousel">
      {group.map((o) => (
        <LodgingCard key={o.offer_id} o={o} city={city} nights={nights} optimal={optimalId === o.offer_id}
          selected={chosen === o.offer_id} tags={tags.get(o.offer_id) ?? []} diff={diffs.get(o.offer_id)}
          onSelect={onSelect} />
      ))}
    </Carousel>
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-display text-lg font-bold text-ink">Alojamiento</h4>
        <p className="text-xs text-muted">{eligible.length} opciones · de menor a mayor precio</p>
      </div>
      {grid(eligible)}
      <CompareLinks links={compare} />
      {rejected.length > 0 && <Rejected count={rejected.length}>{grid(rejected)}</Rejected>}
    </section>
  );
}

// Miniatura: la foto del proveedor (por el proxy propio) o, si no hay, un ícono según el tipo de propiedad.
function Thumbnail({ name, photo }: { name: string; photo?: string | null }) {
  const src = photoSrc(photo);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- miniatura ya optimizada por Google y cacheada por el proxy
      <img src={src} alt={`Foto de ${name}`} loading="lazy" decoding="async" data-testid="lodging-photo"
        className="-mx-6 -mt-6 aspect-[16/9] w-[calc(100%+3rem)] max-w-none rounded-t-3xl object-cover" />
    );
  }
  const hotel = /hotel|hostel|suite/i.test(name);
  return (
    <div aria-hidden data-testid="lodging-thumb"
      className="-mx-6 -mt-6 flex aspect-[16/9] items-center justify-center rounded-t-3xl bg-gradient-to-br from-slate-100 to-indigo-100 text-4xl">
      {hotel ? <Hotel className="size-8" /> : <House className="size-8" />}
    </div>
  );
}

// memo: al seleccionar otro alojamiento solo se redibujan las dos tarjetas cuyo estado cambia.
const LodgingCard = memo(function LodgingCard({ o, city, nights, optimal, selected, tags, diff, onSelect }: {
  o: LodgingOption; city: string; nights: number; optimal: boolean; selected: boolean; tags: PriceTag[]; diff: number | undefined;
  onSelect: (o: LodgingOption) => void;
}) {
  const href = safeHref(o.deeplink);
  const real = !isDemoProvider(o.provider);
  const focus = useMemo(() => pointFocus(city, o.name, "lodging", o), [city, o]);
  return (
    <article role="listitem" data-testid={`lodging-${o.offer_id.split("@")[0]}`}
      className={`flex flex-col rounded-3xl bg-white p-6 transition-all duration-300 ${
        o.rejection ? "opacity-60 shadow-sm" : selected ? "bg-accent/5 shadow-lg ring-2 ring-accent" : "shadow-sm hover:shadow-md"}`}>
      <Thumbnail name={o.name} photo={o.photo_url} />
      <div className="mt-4 flex flex-wrap gap-2">
        {optimal && <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">Óptimo</span>}
        {!o.rejection && <PriceTags tags={tags} />}
        <CardInfo provider={o.provider} fetchedAt={o.fetched_at} className="ml-auto" lines={[
          o.kitchen === true && <span data-testid="kitchen-badge"><ChefHat aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />Cocina incluida</span>,
          real && (o.amenities?.length ?? 0) > 0 && `Comodidades: ${o.amenities!.slice(0, 6).join(", ")}`,
          !o.rejection && bathsHint(o),
        ]} />
      </div>
      <p className="mt-4 font-semibold text-ink">{o.name}</p>
      <Stars stars={o.stars} rating={o.rating} />
      <MapButton focus={focus} className="mt-2" />
      <p className="mt-1 mb-6 text-xs text-muted">{o.rejection ? "—" : unitsText(o)}</p>

      <footer className="mt-auto flex flex-col gap-4 border-t border-line pt-4">
        {o.cost_minor !== null && (
          <div>
            <p className="whitespace-nowrap font-display text-2xl font-extrabold text-ink">{fmtMinor(o.cost_minor)}</p>
            <p className="text-xs text-muted">{nights} noches · impuestos y limpieza incluidos</p>
            {!o.rejection && <VsAverage diff={diff} />}
          </div>
        )}
        {o.rejection ? (
          <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-center text-sm font-medium text-red-700">
            {REJECTION_LABEL[o.rejection] ?? o.rejection}
          </p>
        ) : (
          <button type="button" disabled={selected} aria-pressed={selected} onClick={() => onSelect(o)}
            className={`w-full rounded-full px-5 py-3 text-sm font-semibold transition ${
              selected ? "bg-accent-soft text-accent" : "bg-accent text-white hover:bg-accent-hover"}`}>
            {selected ? "✓ Seleccionado" : "Seleccionar"}
          </button>
        )}
      </footer>
      {href && !o.rejection && (
        <a href={href} target="_blank" rel="noopener noreferrer"
          className="mt-3 rounded-full py-2 text-center text-sm font-semibold text-accent ring-1 ring-accent hover:bg-accent-soft">
          Reservar <ExternalIcon />
        </a>
      )}
    </article>
  );
});
