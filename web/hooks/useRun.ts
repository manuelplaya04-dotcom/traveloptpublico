"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ItineraryRow, Run } from "@/lib/types";

export const TERMINAL = new Set(["done", "infeasible", "failed"]);

// La vista nunca recibe summary/timings nulos aunque la fila llegue incompleta.
const withDefaults = (r: Partial<Run>): Run =>
  ({ ...r, summary: r.summary ?? {}, timings: r.timings ?? {}, error: r.error ?? null }) as Run;

// Estado de una corrida en vivo: Realtime como camino principal y sondeo cada 3 s como respaldo hasta un estado
// terminal; al terminar en `done` trae los itinerarios. RLS: solo devuelve corridas propias.
export function useRun(runId: string) {
  const [run, setRun] = useState<Run | null>(null);
  const [missing, setMissing] = useState(false);
  const [its, setIts] = useState<ItineraryRow[]>([]);
  const [itsFailed, setItsFailed] = useState(false); // la corrida terminó pero no se pudieron traer los resultados
  const [attempt, setAttempt] = useState(0); // "Reintentar" vuelve a pedir los itinerarios
  const retry = useCallback(() => { setItsFailed(false); setAttempt((n) => n + 1); }, []);

  useEffect(() => {
    const supabase = createClient();
    let stopped = false;

    async function load() {
      const { data, error } = await supabase
        .from("search_runs").select("id,status,summary,error,timings").eq("id", runId).single();
      if (!stopped) {
        if (data) setRun(withDefaults(data as Partial<Run>));
        // "no encontrada" solo si la base dice que no hay fila (inexistente o de otro usuario); un corte de red no
        // es "no existe": se sigue sondeando
        else if (error?.code === "PGRST116") setMissing(true);
      }
      return { run: data as Run | null, gone: error?.code === "PGRST116" };
    }

    const channel = supabase
      .channel(`run-${runId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "search_runs", filter: `id=eq.${runId}` },
        // Realtime puede omitir columnas jsonb grandes que no cambiaron (TOAST): se fusiona sobre lo ya cargado.
        (payload) => setRun((prev) => withDefaults({ ...prev, ...(payload.new as Partial<Run>) })))
      .subscribe();
    load();
    const timer = setInterval(async () => {
      const { run: r, gone } = await load();
      if (gone || (r && TERMINAL.has(r.status))) clearInterval(timer);
    }, 3000);

    return () => {
      stopped = true;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [runId]);

  useEffect(() => {
    if (run?.status !== "done") return;
    // Cancelable: si la persona cambia de corrida o sale antes de que responda, la respuesta vieja no pisa el estado.
    const ctl = new AbortController();
    createClient()
      .from("itineraries").select("rank,total_minor,within_budget,payload").eq("run_id", runId).order("rank")
      .abortSignal(ctl.signal)
      .then(({ data, error }) => {
        if (ctl.signal.aborted) return;
        if (error || !data?.length) setItsFailed(true); // "done" siempre tiene itinerarios: vacío = falla de carga
        else setIts(data as ItineraryRow[]);
      }, () => {
        if (!ctl.signal.aborted) setItsFailed(true); // corte de red: el cliente rechaza en vez de devolver `error`
      });
    return () => ctl.abort();
  }, [run?.status, runId, attempt]);

  return { run, missing, its, itsFailed, retry };
}
