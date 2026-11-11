"use client";

import { Printer } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CartProvider, type Allowed } from "@/components/cart/CartContext";
import SubtotalDock from "@/components/cart/SubtotalDock";
import { lodgingSlot } from "@/components/city/LodgingFeed";
import FlightHub, { flightSlot } from "@/components/flights/FlightHub";
import CalendarButton from "@/components/planner/CalendarButton";
import ShareButton from "@/components/planner/ShareButton";
import TripOverview from "@/components/planner/TripOverview";
import Button from "@/components/ui/Button";
import RetryAlert from "@/components/ui/RetryAlert";
import type { Pick } from "@/lib/cart";
import { cityByCode } from "@/lib/cities";
import { onMapFocus } from "@/lib/mapFocus";
import { usePrintMode } from "@/hooks/usePrintMode";
import { useRunData, type RunData } from "@/hooks/useRunData";
import { legOptions, legsFor } from "@/lib/flights";
import { airlineName, isDemoProvider } from "@/lib/format";
import type { ItineraryPayload, ItineraryRow } from "@/lib/types";

// Carga diferida: el dashboard por ciudad y el checkout recién se piden al llegar a su paso.
const loading = () => <p className="text-muted">Cargando…</p>;
const CityDashboard = dynamic(() => import("@/components/city/CityDashboard"), { loading });
const Checkout = dynamic(() => import("@/components/checkout/Checkout"), { loading });

// Carga el pedido y las ofertas de la corrida (RLS: solo las propias) y arma el flujo por pasos sobre la combinación
// de fechas elegida (por defecto, la óptima). Cada combinación tiene su carrito.
export default function TripPlanner({ runId, its, children }: { runId: string; its: ItineraryRow[]; children: ReactNode }) {
  const { data, error, retry } = useRunData(runId);
  const [rank, setRank] = useState(1);

  if (error) return <RetryAlert message={error} onRetry={retry} />;
  if (!data) return <PlannerSkeleton />;

  const best = (its.find((x) => x.rank === rank) ?? its[0]).payload;
  const demo = data.flights.some((f) => isDemoProvider(f.provider));
  return (
    <div className="enter space-y-12">
      {demo && (
        <p className="rounded-2xl bg-amber-50 px-5 py-3 text-sm text-amber-900" data-testid="fixture-notice">
          <b>Estás viendo datos de ejemplo.</b> Precios, horarios y disponibilidad son simulados a partir de lo que
          cargaste, hasta conectar proveedores reales.
        </p>
      )}
      <TripOverview req={data.req} its={its} rank={rank} onRank={setRank} />
      <Steps key={rank} runId={runId} rank={rank} best={best} data={data}>{children}</Steps>
    </div>
  );
}

function Steps({ runId, rank, best, data, children }: {
  runId: string; rank: number; best: ItineraryPayload; data: RunData; children: ReactNode;
}) {
  const [step, setStep] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const { printing, print } = usePrintMode();
  // El checkout (calendario + costos + links) es la versión en papel: se precarga cuando el navegador está libre para
  // que Ctrl+P lo tenga listo, sin sumarlo a la carga inicial.
  useEffect(() => {
    const id = requestIdleCallback(() => void import("@/components/checkout/Checkout"));
    return () => cancelIdleCallback(id);
  }, []);
  // Derivados de la corrida: se calculan una vez por combinación de fechas, no en cada cambio de paso.
  const legs = useMemo(() => legsFor(data.req, best), [data.req, best]);
  const options = useMemo(() => legs.map((l) => legOptions(l, data.flights, data.req)), [legs, data.flights, data.req]);
  const optimal: Record<string, Pick> = useMemo(() => ({
    ...Object.fromEntries(best.flights.map((f) => [flightSlot(f.leg), {
      id: f.offer.id, category: "vuelos", costMinor: f.cost_minor,
      label: `${airlineName(f.offer.carrier)} ${f.offer.origin}→${f.offer.destination}`,
    } satisfies Pick])),
    ...Object.fromEntries(best.stays.map((st) => [lodgingSlot(st.city), {
      id: st.lodging.offer_id, category: "alojamiento", costMinor: st.lodging.cost_minor, label: st.lodging.name,
    } satisfies Pick])),
  }), [best]);
  // Únicas elecciones aceptadas (también al restaurar desde el navegador): opciones elegibles con su costo real.
  const allowed: Allowed = useMemo(() => ({
    ...Object.fromEntries(legs.map((l, i) => [flightSlot(l.index), Object.fromEntries(options[i].filter((o) => !o.rejection)
      .map((o) => [o.offer.id, { id: o.offer.id, category: "vuelos", costMinor: o.costMinor,
        label: `${airlineName(o.offer.carrier)} ${o.offer.origin}→${o.offer.destination}` } satisfies Pick]))])),
    ...Object.fromEntries(best.stays.map((st) => [lodgingSlot(st.city), Object.fromEntries((st.lodging_options ?? [])
      .filter((o) => !o.rejection && o.cost_minor !== null)
      .map((o) => [o.offer_id, { id: o.offer_id, category: "alojamiento", costMinor: o.cost_minor!, label: o.name } satisfies Pick]))])),
  }), [legs, options, best]);
  const steps = [
    { id: "vuelos", label: "Vuelos" },
    ...best.stays.map((st) => ({ id: st.city, label: cityByCode(st.city)?.name ?? st.city })),
    { id: "viaje", label: "Tu viaje" },
  ];
  const go = (i: number) => {
    setStep(i);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // "Ver en mapa" desde otro paso (el aeropuerto de un vuelo): se va al paso de esa ciudad y su mapa toma el pedido al
  // montar. Si ya se está en esa ciudad no cambia nada (el mapa reacciona solo, sin redibujar el paso).
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; }, [step]);
  const cities = useMemo(() => best.stays.map((st) => st.city), [best]);
  useEffect(() => onMapFocus(null, (f) => {
    const i = cities.indexOf(f.city) + 1;
    if (i > 0 && i !== stepRef.current) setStep(i);
  }), [cities]);
  const stay = best.stays[step - 1];

  return (
    <CartProvider base={best.breakdown.by_category} optimal={optimal} allowed={allowed} budgetMinor={data.req.budget_minor}
      storageKey={`travelopt:cart:${runId}:${rank}`}>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-12">
        <div ref={top} className="scroll-mt-6 space-y-10">
          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <nav aria-label="Pasos del viaje" className="flex gap-2 overflow-x-auto rounded-full bg-surface p-1.5 ring-1 ring-line sm:inline-flex">
            {steps.map((s, i) => (
              <button key={s.id} type="button" onClick={() => go(i)} aria-current={i === step ? "step" : undefined}
                data-testid={`step-${s.id}`}
                className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm transition ${
                  i === step ? "bg-white font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                <span className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                  i === step ? "bg-accent text-white" : i < step ? "bg-accent-soft text-accent" : "bg-white text-muted"}`}>
                  {i < step ? "✓" : i + 1}
                </span>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="flex flex-wrap items-start gap-2">
            <CalendarButton payload={best} />
            <ShareButton runId={runId} />
            <Button variant="secondary" onClick={print} data-testid="print"><Printer aria-hidden className="mr-1.5 inline size-4 align-text-bottom" />Imprimir / PDF</Button>
          </div>
          </div>

          {/* En papel solo va el itinerario completo (checkout); los pasos interactivos se ocultan. */}
          <div className="space-y-10 print:hidden">
          {step === 0 && <FlightHub req={data.req} legs={legs} options={options} runId={runId} />}
          {stay && (
            <CityDashboard key={stay.city} index={step - 1} stay={stay} req={data.req} weather={data.weather}
              transport={data.transport} activities={data.activities} />
          )}
          </div>
          {(step === steps.length - 1 || printing) && (
            <>
              <Checkout best={best} req={data.req} legs={legs} options={options} transport={data.transport} />
              <div className="space-y-6 print:hidden">{children}</div>
            </>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-line pt-6 print:hidden">
            {step > 0 ? <Button variant="ghost" onClick={() => go(step - 1)}>← {steps[step - 1].label}</Button> : <span />}
            {step < steps.length - 1 && <Button size="lg" onClick={() => go(step + 1)}>Siguiente: {steps[step + 1].label} →</Button>}
          </div>
        </div>
        <div className="print:hidden"><SubtotalDock /></div>
      </div>
    </CartProvider>
  );
}

// Esqueleto con la misma estructura que el planificador (resumen, pasos, tarjetas y panel): al llegar los datos el
// contenido ocupa el mismo lugar y no hay saltos de layout.
function PlannerSkeleton() {
  return (
    <div className="animate-pulse space-y-12" role="status" aria-label="Cargando opciones">
      <div className="h-56 rounded-3xl bg-surface" />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
        <div className="space-y-6">
          <div className="h-12 w-2/3 rounded-full bg-surface" />
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-72 rounded-3xl bg-surface" />)}
          </div>
        </div>
        <div className="hidden h-80 rounded-3xl bg-surface lg:block" />
      </div>
    </div>
  );
}
