"use client";

import { useEffect, useState } from "react";
import { isAdviceMap, type AdviceEntry } from "@/lib/priceAdvice";

// Consejo por vuelo de la corrida. Vacío mientras carga, si falla o en cold start: nunca bloquea la vista.
export function usePriceAdvice(runId: string): Record<string, AdviceEntry> {
  const [advice, setAdvice] = useState<Record<string, AdviceEntry>>({});
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/price-advice?${new URLSearchParams({ runId })}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { advice?: unknown } | null) => { if (isAdviceMap(d?.advice)) setAdvice(d.advice); })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [runId]);
  return advice;
}
