"use client";

import { Bike, Drama, Landmark, RollerCoaster, Ship, Ticket, Trees, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useMemo, useState } from "react";
import { safeHref } from "@/lib/links";
import Button from "@/components/ui/Button";
import type { TripRequest } from "@/lib/contracts";
import { useMoney } from "@/components/money/MoneyProvider";
import { activityLoad } from "@/lib/onboarding";
import { createRun, runErrorMessage } from "@/lib/runs";
import Alert from "@/components/ui/Alert";
import type { ActivityOfferRow } from "@/lib/types";
import Carousel from "@/components/ui/Carousel";
import MapButton from "@/components/ui/MapButton";
import { pointFocus } from "@/lib/mapTargets";
import { activityPriceHint, activityPriceLabel, type PriceSource } from "@/lib/activityPrice";
import CardInfo from "@/components/ui/CardInfo";
import ExternalIcon from "@/components/ui/ExternalIcon";

type Item = {
  key: string; name: string; outdoor: boolean; slots: number; deeplink: string | null; min: number; max: number; provider: string;
  source?: PriceSource; dateBased?: boolean; lat?: number | null; lon?: number | null;
};

// Todo lo que se puede hacer en la ciudad (catálogo del proveedor para las fechas de la estadía). El usuario marca
// lo que quiere hacer y el motor re-optimiza el calendario: elige el día de cada actividad respetando clima, días
// seguidos y capacidad diaria, al menor costo.
export default memo(function ActivityCatalog({ req, city, offers }: { req: TripRequest; city: string; offers: ActivityOfferRow[] }) {
  const money = useMoney(); // precios en la moneda elegida (USD o pesos)
  const router = useRouter();
  const current = req.cities.find((c) => c.code === city)?.must_do ?? [];
  const [chosen, setChosen] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items: Item[] = Object.values(offers.filter((o) => o.city === city).reduce<Record<string, Item>>((acc, o) => {
    const it = acc[o.activity_key] ??= { key: o.activity_key, name: o.name, outdoor: o.outdoor, slots: o.slots,
      deeplink: o.deeplink, min: o.price_per_pax_minor, max: o.price_per_pax_minor, provider: o.provider,
      source: o.price_source, dateBased: o.price_date_based, lat: o.lat, lon: o.lon };
    it.min = Math.min(it.min, o.price_per_pax_minor);
    it.max = Math.max(it.max, o.price_per_pax_minor);
    return acc;
  }, {})).sort((a, b) => Number(current.includes(b.key)) - Number(current.includes(a.key)) || a.name.localeCompare(b.name));

  const changed = [...chosen].sort().join() !== [...current].sort().join();
  // Capacidad real: los días que el motor consultó para la ciudad (sus días utilizables para actividades).
  const load = useMemo(() => activityLoad(items.filter((i) => chosen.includes(i.key)),
    new Set(offers.filter((o) => o.city === city).map((o) => o.date)).size), [items, chosen, offers, city]);
  const toggle = (k: string) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  async function optimize() {
    setBusy(true);
    setError(null);
    try {
      const cities = req.cities.map((c) => (c.code === city ? { ...c, must_do: items.map((i) => i.key).filter((k) => chosen.includes(k)) } : c));
      router.push(`/runs/${await createRun({ ...req, cities })}`);
    } catch (e) {
      setError(runErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4" data-testid={`catalog-${city}`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h4 className="font-display text-lg font-bold text-ink">Qué se puede hacer</h4>
          <p className="text-sm text-muted">Marcá lo que querés hacer y armamos el calendario óptimo con eso.</p>
        </div>
        {changed && (
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setChosen(current)}>Deshacer</Button>
            <Button disabled={busy || chosen.length === 0} onClick={optimize}>
              {busy ? "Optimizando…" : `Optimizar calendario (${chosen.length})`}
            </Button>
          </div>
        )}
      </div>
      <Carousel label="Actividades para elegir" testId="activity-carousel">
        {items.map((it) => {
          const on = chosen.includes(it.key);
          const href = safeHref(it.deeplink);
          return (
            <div role="listitem" key={it.key}>
              {/* Tarjeta táctil: toda la tarjeta marca el checkbox nativo (teclado y lectores de pantalla intactos). */}
              <label className={`flex h-full cursor-pointer gap-3 rounded-2xl p-4 lift transition-colors duration-300 ${
                on ? "bg-accent/5 shadow-md ring-2 ring-accent" : "bg-white shadow-sm"}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(it.key)} aria-label={it.name}
                  className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--color-accent)]" />
                <ActivityThumb name={it.name} outdoor={it.outdoor} fullDay={it.slots === 2} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-1">
                    <span className="block min-w-0 font-semibold text-ink">{it.name}</span>
                    <CardInfo provider={it.provider} />
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    <span>{it.slots === 2 ? "Día completo" : "Medio día"}</span>
                    <span>{it.outdoor ? "Al aire libre" : "Bajo techo"}</span>
                    {href && <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline"
                      onClick={(e) => e.stopPropagation()}>Ver <ExternalIcon /></a>}
                    <MapButton focus={pointFocus(city, it.name, "activity", it)} inline />
                  </span>
                  {/* Precio debajo (no en una columna aparte): en tarjetas de 280 px la columna fija dejaba ~20 px al nombre. */}
                  <span className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold text-ink">
                      {it.source === "box_office" || it.source === "curated" ? activityPriceLabel(it.min, it.source, it.dateBased, money)
                        : it.min === it.max ? money(it.min) : `${money(it.min)} a ${money(it.max)}`}
                    </span>
                    <span className="text-xs text-muted" title={activityPriceHint(it.source, it.dateBased)}>
                      {it.source === "box_office" ? "no se suma al total" : "por persona"}
                    </span>
                  </span>
                </span>
              </label>
            </div>
          );
        })}
      </Carousel>
      {changed && !load.fits && (
        <Alert tone="warning" compact data-testid="activity-overload">
          Elegiste {load.days.toLocaleString("es-AR")} días de actividades y la estadía tiene {load.availableDays} disponibles:
          es probable que no haya calendario posible. Quitá alguna o sumá noches.
        </Alert>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
  );
});

// Miniatura de proporción fija (sin saltos de layout) con un ícono según el tipo, hasta tener fotos con licencia
// (Wikidata/Commons, Fase 6.3).
function ActivityThumb({ name, outdoor, fullDay }: { name: string; outdoor: boolean; fullDay: boolean }) {
  const Icon: LucideIcon = /museo|galer|moma|historia/i.test(name) ? Landmark : /show|espect|musical|broadway|cena/i.test(name) ? Drama
    : /barco|crucero/i.test(name) ? Ship : /bici/i.test(name) ? Bike : /cocina|gastron/i.test(name) ? UtensilsCrossed
      : fullDay ? RollerCoaster : outdoor ? Trees : Ticket;
  return (
    <span aria-hidden data-testid="activity-thumb"
      className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-50 to-indigo-100 text-accent">
      <Icon className="size-6" />
    </span>
  );
}
