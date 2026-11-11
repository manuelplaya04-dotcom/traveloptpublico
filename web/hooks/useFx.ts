"use client";

import { useEffect, useState } from "react";
import type { FxRates } from "@/lib/fx";

// Cotización del dólar para mostrar el viaje en pesos. Si falla, queda en null y quien la usa no muestra nada.
export function useFx(): FxRates | null {
  const [rates, setRates] = useState<FxRates | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/fx", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FxRates | null) => { if (d?.tarjeta && d?.mep) setRates(d); })
      .catch(() => undefined);
    return () => ctl.abort();
  }, []);
  return rates;
}
