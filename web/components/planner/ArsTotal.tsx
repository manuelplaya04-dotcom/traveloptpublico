"use client";

import { useFx } from "@/components/money/MoneyProvider";
import { arsFromUsdMinor, fmtArs, fmtRate } from "@/lib/fx";

const UPDATED_FORMAT = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const TIP = {
  tarjeta: "Pagando en dólares con tarjeta argentina y cancelando el resumen en pesos: tipo de cambio oficial más " +
    "percepciones impositivas (valor publicado por dolarapi.com). El monto final depende del día de cierre del resumen.",
  mep: "Comprando dólares MEP (dólar bolsa) en tu banco o broker y pagando en dólares: sin percepciones. " +
    "El valor cambia durante el día.",
};

// El total del viaje en pesos, en las dos formas habituales de pagar desde Argentina. Es una referencia: el total
// del motor sigue siendo en dólares. Si la cotización no está disponible, no se muestra nada.
export default function ArsTotal({ totalMinor }: { totalMinor: number }) {
  const { rates: fx } = useFx();
  if (!fx) return null;
  const updated = UPDATED_FORMAT.format(new Date(fx.mep.updated_at));
  const row = (key: "tarjeta" | "mep", label: string) => {
    const pesos = arsFromUsdMinor(totalMinor, fx[key].cents_per_usd);
    return (
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-sm text-muted">
          {label}{" "}
          <abbr title={TIP[key]} className="cursor-help no-underline" aria-label={`Qué es el ${label.toLowerCase()}: ${TIP[key]}`}>ⓘ</abbr>
        </dt>
        <dd className="font-display text-lg font-extrabold text-ink" data-testid={`ars-${key}`}>
          {pesos === null ? "—" : fmtArs(pesos)}
        </dd>
      </div>
    );
  };
  return (
    <section aria-label="Total en pesos argentinos" data-testid="ars-total" className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">En pesos argentinos</p>
      <dl className="mt-2 space-y-1">
        {row("tarjeta", "Dólar tarjeta")}
        {row("mep", "Dólar MEP")}
      </dl>
      <p className="mt-2 text-xs text-muted">
        Referencia con cotizaciones de {fx.source} ({updated}{fx.stale ? ", última guardada" : ""}).
        Tarjeta {fmtRate(fx.tarjeta.cents_per_usd)} · MEP {fmtRate(fx.mep.cents_per_usd)} por dólar.
      </p>
    </section>
  );
}
