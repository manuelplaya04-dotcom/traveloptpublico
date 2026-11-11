"use client";

import { useState } from "react";
import { safeHref } from "@/lib/links";
import { useCart } from "@/components/cart/CartContext";
import ItineraryTimeline from "@/components/checkout/ItineraryTimeline";
import { lodgingSlot } from "@/components/city/LodgingFeed";
import { flightSlot } from "@/components/flights/FlightHub";
import Button from "@/components/ui/Button";
import ExternalIcon from "@/components/ui/ExternalIcon";
import { groupByStay, rubros, splitPerPax, timeline } from "@/lib/checkout";
import { cityByCode } from "@/lib/cities";
import type { TripRequest } from "@/lib/contracts";
import type { FlightOption, Leg } from "@/lib/flights";
import { airlineName, TRANSPORT_MODE } from "@/lib/format";
import { fmtMinor } from "@/lib/money";
import type { ItineraryPayload, TransportQuote } from "@/lib/types";
import Alert from "@/components/ui/Alert";
import BuyTimingSlot from "@/components/ui/BuyTimingSlot";

type Link = { label: string; href: string | undefined };

// Pantalla 5: calendario final con lo elegido, subtotal por rubro y confirmación. TravelOpt no reserva: al confirmar
// se fija la selección y se listan los links de compra de cada parte.
export default function Checkout({ best, req, legs, options, transport }: {
  best: ItineraryPayload; req: TripRequest; legs: Leg[]; options: FlightOption[][]; transport: TransportQuote[];
}) {
  const { cart, totals: t, budgetMinor } = useCart();
  const [confirmed, setConfirmed] = useState(false);

  const pickId = (slot: string) => cart.selected[slot]?.id ?? cart.optimal[slot]?.id;
  const flights = legs.map((l, i) => options[i].find((o) => o.offer.id === pickId(flightSlot(l.index))));
  const lodging = (city: string) => best.stays.find((s) => s.city === city)?.lodging_options
    ?.find((o) => o.offer_id === pickId(lodgingSlot(city)));
  const days = timeline(best, flights.flatMap((f) => (f ? [f.offer] : [])),
    (city) => cart.selected[lodgingSlot(city)]?.label ?? cart.optimal[lodgingSlot(city)]?.label ?? city,
    (city) => cityByCode(city)?.name ?? city);
  const r = rubros(t, legs, (l) => flights[legs.indexOf(l)]?.costMinor ?? 0);
  const perPax = splitPerPax(t.totalMinor, req.pax);
  const over = t.totalMinor - budgetMinor;

  const links: Link[] = [
    ...flights.flatMap((f) => (f ? [{ label: `Vuelo ${f.offer.origin}→${f.offer.destination} · ${airlineName(f.offer.carrier)}`, href: safeHref(f.offer.deeplink) }] : [])),
    ...best.stays.map((s) => ({ label: `Alojamiento · ${lodging(s.city)?.name ?? s.lodging.name}`, href: safeHref(lodging(s.city)?.deeplink ?? s.lodging.deeplink) })),
    ...best.stays.flatMap((s) => s.activities.map((a) => ({ label: `Entradas · ${a.name}`, href: safeHref(a.deeplink) }))),
    ...transport.filter((q) => best.stays.some((s) => s.city === q.city)).map((q) => ({ label: `${TRANSPORT_MODE[q.mode] ?? q.mode} · ${q.city}`, href: safeHref(q.deeplink) })),
  ];

  return (
    <section id="checkout" aria-labelledby="checkout-title" className="scroll-mt-6 space-y-8">
      <div>
        <h2 id="checkout-title" className="font-display text-3xl font-black tracking-tight text-ink sm:text-4xl">Tu viaje, día por día</h2>
        <p className="mt-3 text-muted print:hidden">Con todo lo que elegiste. Si cambiás algo arriba, este calendario se actualiza solo.</p>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <ItineraryTimeline groups={groupByStay(days, best.stays)} />

        <aside className="break-inside-avoid space-y-5 rounded-3xl bg-surface p-6 sm:p-8 print:border print:border-black" aria-label="Resumen de costos">
          <h3 className="font-display text-lg font-bold text-ink">Resumen</h3>
          <dl className="space-y-2 text-sm">
            {r.map((x) => (
              <div key={x.key} className="flex justify-between gap-3">
                <dt className="text-muted">{x.label}</dt>
                <dd className="tabular-nums text-ink" data-testid={`rubro-${x.key}`}>{fmtMinor(x.minor)}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-line pt-4">
            <p className="text-sm text-muted">Total final</p>
            <p className="font-display text-3xl font-black tracking-tight text-ink" data-testid="checkout-total">{fmtMinor(t.totalMinor)}</p>
            <p className="mt-1 text-xs text-muted">
              Por persona: <span data-testid="checkout-per-pax">{perPax.map((x) => fmtMinor(x)).join(" / ")}</span>
            </p>
            {over > 0 && (
              <div className="mt-3">
                <Alert tone="warning" compact data-testid="checkout-over-budget">Supera el presupuesto por {fmtMinor(over)}</Alert>
              </div>
            )}
          </div>
          {!confirmed ? (
            <Button size="lg" className="w-full print:hidden" onClick={() => setConfirmed(true)}>Confirmar itinerario</Button>
          ) : (
            <div role="status" className="space-y-4">
              <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                ✓ Itinerario confirmado. Reservá cada parte en su sitio:
              </p>
              <ul className="space-y-2 text-sm" data-testid="purchase-links">
                {links.map((l) => (
                  <li key={l.label} className="flex items-center justify-between gap-3">
                    <span className="text-ink">{l.label}</span>
                    {l.href ? (
                      <a href={l.href} target="_blank" rel="noopener noreferrer" className="shrink-0 font-semibold text-accent hover:underline">Ir <ExternalIcon /></a>
                    ) : <span className="shrink-0 text-xs text-muted">sin link</span>}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">Los precios pueden cambiar hasta que reserves en cada proveedor.</p>
              <Button variant="secondary" className="w-full print:hidden" onClick={() => window.print()}>Imprimir o guardar en PDF</Button>
            </div>
          )}
          <BuyTimingSlot />
        </aside>
      </div>
    </section>
  );
}
