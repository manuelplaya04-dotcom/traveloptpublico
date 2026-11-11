"use client";

import { useCallback, useEffect, useState } from "react";
import { tripRequestSchema, type TripRequest } from "@/lib/contracts";
import { createClient } from "@/lib/supabase/client";
import type { ActivityOfferRow, FlightOffer, TransportQuote, WeatherDay } from "@/lib/types";

export type RunData = {
  req: TripRequest; flights: FlightOffer[]; weather: WeatherDay[]; transport: TransportQuote[]; activities: ActivityOfferRow[];
};

// Pedido y ofertas de una corrida terminada, en paralelo (RLS: solo las propias). El pedido se valida con el contrato.
export function useRunData(runId: string) {
  const [data, setData] = useState<RunData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setError(null); setAttempt((n) => n + 1); }, []);

  useEffect(() => {
    const supabase = createClient();
    const ctl = new AbortController(); // limpieza: sin setState después de desmontar o de cambiar de corrida
    Promise.all([
      supabase.from("search_runs").select("trip_requests(payload)").eq("id", runId).abortSignal(ctl.signal).single(),
      supabase.from("run_offers").select("kind,payload").eq("run_id", runId)
        .in("kind", ["flights", "weather", "transport", "activities"]).abortSignal(ctl.signal),
    ]).catch(() => null).then((res) => {
      if (ctl.signal.aborted) return;
      if (!res) return setError("No pudimos cargar las opciones de esta corrida.");
      const [run, offers] = res;
      const payload = (run.data?.trip_requests as unknown as { payload: unknown } | null)?.payload;
      const req = tripRequestSchema.safeParse(payload);
      if (!req.success || offers.error) return setError("No pudimos cargar las opciones de esta corrida.");
      const of = <T,>(kind: string) => (offers.data ?? []).filter((r) => r.kind === kind).map((r) => r.payload as T);
      setData({ req: req.data, flights: of<FlightOffer>("flights"), weather: of<WeatherDay>("weather"),
        transport: of<TransportQuote>("transport"), activities: of<ActivityOfferRow>("activities") });
    });
    return () => ctl.abort();
  }, [runId, attempt]);

  return { data, error, retry };
}
