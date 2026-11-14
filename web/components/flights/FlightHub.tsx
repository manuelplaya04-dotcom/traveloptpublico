"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useCart } from "@/components/cart/CartContext";
import FlightCard, { type FlightSignals } from "@/components/flights/FlightCard";
import Rejected from "@/components/ui/Rejected";
import { cityByCode, originFor } from "@/lib/cities";
import type { TripRequest } from "@/lib/contracts";
import type { FlightOption, Leg } from "@/lib/flights";
import { airlineName, fmtDay } from "@/lib/format";
import { dailyLows, fewSeats, groupStats, priceTags, vsAverage } from "@/lib/market";
import Carousel from "@/components/ui/Carousel";
import { usePriceAdvice } from "@/hooks/usePriceAdvice";
import { airportFocus } from "@/lib/mapTargets";
import { useMoney } from "@/components/money/MoneyProvider";

const place = (code: string, req: TripRequest) =>
  code === "HOME" ? (originFor(req.origin_airports)?.name.split(" (")[0] ?? "Casa")
    : cityByCode(code)?.name ?? code;

export const flightSlot = (leg: number) => `flight:${leg}`;

type Tab = number | "all"; // índice de tramo o todos juntos

// Pantalla 3: una pestaña por tramo (ida, interconexiones, vuelta) más "Todos". Cada tramo muestra las opciones que
// sirven a las fechas del itinerario; la óptima viene preseleccionada y las descartadas muestran su motivo.
export default function FlightHub({ req, legs, options, runId }: {
  req: TripRequest; legs: Leg[]; options: FlightOption[][]; runId: string;
}) {
  const money = useMoney(); // precios en la moneda elegida (USD o pesos)
  const { cart, choose } = useCart();
  const advice = usePriceAdvice(runId);
  const [tab, setTab] = useState<Tab>(0);
  const middles = legs.filter((l) => l.from !== "HOME" && l.to !== "HOME").length;
  const kind = (l: Leg) => l.from === "HOME" ? "Ida" : l.to === "HOME" ? "Vuelta"
    : middles > 1 ? `Interconexión ${l.index}` : "Interconexión";
  // Derivados pesados de las opciones, una sola vez por corrida (no en cada cambio del carrito).
  const signals = useMemo(() => options.map((opts) => legSignals(opts, req.pax)), [options, req.pax]);
  const selectors = useMemo(() => legs.map((l) => (o: FlightOption) => choose(flightSlot(l.index), {
    id: o.offer.id, category: "vuelos", costMinor: o.costMinor,
    label: `${airlineName(o.offer.carrier)} ${o.offer.origin}→${o.offer.destination}`,
  })), [legs, choose]);
  // Aeropuerto de cada oferta en el mapa de su ciudad: se calcula una vez por corrida (objetos estables para memo).
  const foci = useMemo(() => {
    const cities = req.cities.map((c) => c.code);
    return new Map(options.flat().map((o) => [o.offer.id, airportFocus(o.offer, cities)]));
  }, [options, req.cities]);
  const chosenId = (l: Leg) => cart.selected[flightSlot(l.index)]?.id ?? cart.optimal[flightSlot(l.index)]?.id;
  const chosenCost = (l: Leg, i: number) => options[i].find((o) => o.offer.id === chosenId(l))?.costMinor;

  const tabs: Tab[] = [...legs.map((_, i) => i), "all"];
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const next = tabs[(tabs.indexOf(tab) + d + tabs.length) % tabs.length];
    setTab(next);
    document.getElementById(`flight-tab-${next}`)?.focus();
  };
  const shown = tab === "all" ? legs.map((_, i) => i) : [tab];

  return (
    <section aria-labelledby="flights-title" className="space-y-10">
      <div>
        <h2 id="flights-title" className="font-display text-3xl font-black tracking-tight text-ink sm:text-4xl">Tus vuelos</h2>
        <p className="mt-3 max-w-2xl text-muted">
          Marcamos la opción óptima de cada tramo. Podés elegir otra: el subtotal se actualiza al instante.
        </p>
      </div>

      <div role="tablist" aria-label="Tramos" onKeyDown={onKey}
        className="flex gap-2 overflow-x-auto rounded-full bg-surface p-1.5 ring-1 ring-line sm:inline-flex">
        {tabs.map((t) => {
          const active = t === tab;
          const leg = t === "all" ? null : legs[t];
          const cost = leg ? chosenCost(leg, t as number) : undefined;
          return (
            <button key={String(t)} id={`flight-tab-${t}`} type="button" role="tab" aria-selected={active}
              aria-controls="flight-panel" tabIndex={active ? 0 : -1} onClick={() => setTab(t)}
              className={`shrink-0 rounded-full px-5 py-2.5 text-left text-sm transition ${
                active ? "bg-white font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
              <span className="block">{leg ? kind(leg) : "Todos"}</span>
              <span className={`block text-xs ${active ? "text-accent" : "text-muted"}`}>
                {leg ? (cost !== undefined ? money(cost) : "—") : `${legs.length} tramos`}
              </span>
            </button>
          );
        })}
      </div>

      <div id="flight-panel" role="tabpanel" aria-labelledby={`flight-tab-${tab}`} className="space-y-14">
        {shown.map((i) => {
          const leg = legs[i];
          const slot = flightSlot(leg.index);
          return (
            <div key={slot} className="space-y-5">
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-xl font-bold text-ink">
                  <span className="mr-2 text-sm font-semibold uppercase tracking-wide text-accent">{kind(leg)}</span>
                  {place(leg.from, req)} → {place(leg.to, req)}
                </h3>
                <p className="text-sm text-muted">{fmtDay(leg.arriveOn ?? leg.departDates[0])} · {options[i].length} opciones</p>
              </header>
              {[options[i].filter((o) => !o.rejection), options[i].filter((o) => o.rejection)].map((group, g) => {
                const grid = (
                  <Carousel label={`Vuelos ${kind(leg).toLowerCase()} ${place(leg.from, req)} a ${place(leg.to, req)}`}>
                    {group.map((o) => (
                      <div role="listitem" key={o.offer.id} className="flex">
                        <FlightCard
                          option={o}
                          pax={req.pax}
                          bagsPerPax={req.constraints.checked_bags_per_pax}
                          optimal={cart.optimal[slot]?.id === o.offer.id}
                          selected={chosenId(leg) === o.offer.id}
                          signals={signals[i].get(o.offer.id)}
                          advice={advice[o.offer.id]?.advice}
                          mapFocus={foci.get(o.offer.id)}
                          onSelect={selectors[i]}
                        />
                      </div>
                    ))}
                  </Carousel>
                );
                return g === 0 ? <div key="ok">{grid}</div> : <Rejected key="no" count={group.length}>{grid}</Rejected>;
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Etiquetas, diferencia contra el promedio y precio mínimo por día de las opciones elegibles de un tramo.
function legSignals(opts: FlightOption[], pax: number): Map<string, FlightSignals> {
  const ok = opts.filter((o) => !o.rejection);
  const stats = groupStats(ok.map((o) => o.costMinor));
  const trend = dailyLows(ok.map((o) => ({ date: o.offer.depart_at.slice(0, 10), price: o.costMinor })));
  return new Map(ok.map((o) => [o.offer.id, {
    tags: priceTags(o.costMinor, stats, fewSeats(o.offer.seats_available, pax), ok.length),
    diff: vsAverage(o.costMinor, stats),
    trend,
  }]));
}
