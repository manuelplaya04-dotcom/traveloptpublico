import { TrendingUp } from "lucide-react";
import type { BuyTimingInsight } from "@/lib/buyTiming";

const ADVICE: Record<BuyTimingInsight["advice"], string> = {
  comprar_ahora: "Buen momento para comprar",
  esperar: "Conviene esperar",
  sin_datos_suficientes: "Todavía no hay historial suficiente",
};

// Espacio reservado para "Momento óptimo de compra". Sin insight (hoy siempre) muestra "Próximamente" y no inventa
// tendencias; con insight real muestra la recomendación y su respaldo.
export default function BuyTimingSlot({ insight }: { insight?: BuyTimingInsight }) {
  return (
    <section aria-labelledby="buy-timing-title" data-testid="buy-timing"
      className="rounded-2xl border border-dashed border-line p-4 text-sm print:hidden">
      <h4 id="buy-timing-title" className="flex items-center gap-2 font-semibold text-ink">
        <TrendingUp aria-hidden className="mr-1 inline size-4 align-text-bottom" />Momento óptimo de compra
        {!insight && <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted">Próximamente</span>}
      </h4>
      <p className="mt-1 text-xs text-muted">
        {insight
          ? `${ADVICE[insight.advice]} · ${insight.vsMedianPct}% vs. la mediana de ${insight.windowDays} días`
          : "Vamos a comparar el precio de hoy con su historial para decirte si conviene comprar ahora o esperar."}
      </p>
    </section>
  );
}
