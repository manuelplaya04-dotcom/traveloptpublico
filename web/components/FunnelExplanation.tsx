"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import GuidedTour from "@/components/tour/GuidedTour";
import { parseExplanation, type Explanation } from "@/lib/explanation";
import { INFEASIBLE_TOUR } from "@/lib/tour";

const TIMEOUT_MS = 45_000; // contrafactuales del optimizador + posible arranque en frío del motor

// Por qué no hubo resultados, en palabras. Mientras carga muestra un renglón de espera; si falla, tarda o llega algo
// raro, no muestra nada (las sugerencias de siempre siguen debajo). Sin errores en consola: la falla es esperable.
export default function FunnelExplanation({ runId }: { runId: string }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; value: Explanation } | { status: "none" }>(
    { status: "loading" });

  useEffect(() => {
    let mounted = true; // el abort lo usan tanto el tiempo agotado (se oculta) como el desmontaje (no se toca el estado)
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    fetch(`/api/explanation?${new URLSearchParams({ runId })}`, { signal: ctl.signal })
      .then(async (r) => (r.ok ? parseExplanation(await r.json().catch(() => null)) : null))
      .catch(() => null)
      .then((value) => { if (mounted) setState(value ? { status: "ready", value } : { status: "none" }); })
      .finally(() => clearTimeout(timer));
    return () => { mounted = false; clearTimeout(timer); ctl.abort(); };
  }, [runId]);

  if (state.status === "none") return null;
  if (state.status === "loading") {
    return <p className="mt-2 animate-pulse text-sm font-normal text-muted" role="status">Analizando por qué no hubo resultados…</p>;
  }
  return (
    <div className="mt-2 rounded-xl bg-white/70 p-3 font-normal" data-testid="funnel-explanation" data-tour="explanation">
      <GuidedTour tour={INFEASIBLE_TOUR} />
      <p className="text-sm text-ink">{state.value.text}</p>
      <p className="mt-1 flex items-center gap-1 text-xs text-muted" data-testid="funnel-explanation-source">
        {state.value.source === "ai" ? (
          <><Sparkles aria-hidden className="size-3.5" />Redactado con IA (Gemini) a partir de los cálculos del optimizador.</>
        ) : "Explicación automática a partir de los cálculos del optimizador."}
      </p>
    </div>
  );
}
