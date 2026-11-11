"use client";

import { useFx } from "@/hooks/useFx";
import { arsFromUsdMinor, fmtArs } from "@/lib/fx";

const TIP = {
  tarjeta: "Pagando en dólares con tarjeta argentina y cancelando el resumen en pesos: tipo de cambio oficial más " +
    "percepciones impositivas (valor publicado por dolarapi.com). El monto final depende del día de cierre del resumen.",
  mep: "Comprando dólares MEP (dólar bolsa) en tu banco o broker y pagando en dólares: sin percepciones. " +
    "El valor cambia durante el día.",
};

// El total del viaje en pesos, en las dos formas habituales de pagar desde Argentina. Es una referencia: el total
// del motor sigue siendo en dólares. Si la cotización no está disponible, no se muestra nada.
export default function ArsTotal({ totalMinor }: { totalMinor: number }) {
  const fx = useFx();
  if (!fx) return null;
  const updated = new Date(fx.mep.updatedAt).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const row = (key: "tarjeta" | "mep", label: string) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted">
        {label}{" "}
        <abbr title={TIP[key]} className="cursor-help no-underline" aria-label={`Qué es el ${label.toLowerCase()}: ${TIP[key]}`}>ⓘ</abbr>
      </dt>
      <dd className="font-display text-lg font-extrabold text-ink" data-testid={`ars-${key}`}>
        {fmtArs(arsFromUsdMinor(totalMinor, fx[key].venta))}
      </dd>
    </div>
  );
  return (
    <section aria-label="Total en pesos argentinos" data-testid="ars-total" className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">En pesos argentinos</p>
      <dl className="mt-2 space-y-1">
        {row("tarjeta", "Dólar tarjeta")}
        {row("mep", "Dólar MEP")}
      </dl>
      <p className="mt-2 text-xs text-muted">
        Referencia con cotizaciones de {fx.source} ({updated}). Tarjeta {fmtArs(fx.tarjeta.venta)} · MEP {fmtArs(fx.mep.venta)} por dólar.
      </p>
    </section>
  );
}
