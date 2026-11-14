"use client";

import { useEffect, useState } from "react";
import RouteMap, { type Stop } from "@/components/planner/RouteMap";
import { cityByCode, originFor } from "@/lib/cities";
import { factsFor } from "@/lib/cityFacts";
import type { TripRequest } from "@/lib/contracts";
import { createClient } from "@/lib/supabase/client";

const FACT_MS = 6000;

// Lo que ya se sabe mientras el motor resuelve (o despierta: hasta ~40 s en el plan gratuito): el recorrido pedido y
// datos de los destinos. Sale del pedido guardado y de tablas estáticas, sin esperar al motor. Es un extra: si el
// pedido no se puede leer no se dibuja y queda el progreso de siempre.
export default function TripPreview({ runId }: { runId: string }) {
  const [req, setReq] = useState<TripRequest | null>(null);
  const [fact, setFact] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    void createClient().from("search_runs").select("trip_requests(payload)").eq("id", runId).abortSignal(ctl.signal).single()
      .then(({ data }) => {
        const payload = (data?.trip_requests as unknown as { payload: TripRequest } | null)?.payload;
        if (!ctl.signal.aborted && Array.isArray(payload?.cities)) setReq(payload);
      }, () => undefined);
    return () => ctl.abort();
  }, [runId]);

  const facts = factsFor(req?.cities.map((c) => c.code) ?? []);
  useEffect(() => {
    if (facts.length < 2) return;
    const id = setInterval(() => setFact((f) => f + 1), FACT_MS);
    return () => clearInterval(id);
  }, [facts.length]);

  if (!req) return null;
  const home = originFor(req.origin_airports);
  const homeStops: Stop[] = home ? [{ code: "HOME", name: home.name.split(" (")[0], lat: home.lat, lon: home.lon }] : [];
  const cityStops: Stop[] = req.cities.map((c) => ({ code: c.code, name: cityByCode(c.code)?.name ?? c.name ?? c.code, lat: c.lat, lon: c.lon }));

  return (
    <div className="mt-6 space-y-4 text-left" data-testid="trip-preview">
      <RouteMap stops={[...homeStops, ...cityStops, ...homeStops]} />
      {!req.fixed_order && (
        <p className="text-center text-sm text-muted" data-testid="preview-free-order">
          Estamos probando todos los órdenes posibles: el recorrido del mapa es provisorio hasta tener el más barato.
        </p>
      )}
      <ul className="flex flex-wrap justify-center gap-2 text-sm text-ink">
        {req.cities.map((c) => (
          <li key={c.code} className="rounded-full bg-white px-3 py-1 ring-1 ring-line">
            {cityByCode(c.code)?.name ?? c.name ?? c.code} · {c.min_nights} {c.min_nights === 1 ? "noche" : "noches"}
          </li>
        ))}
      </ul>
      {facts.length > 0 && (
        // Alto reservado: el cambio de frase no mueve la pantalla. Sin aria-live: no interrumpe al lector de pantalla.
        <p className="min-h-10 text-center text-sm text-muted" data-testid="trip-fact">
          <b className="font-semibold text-ink">¿Sabías que…?</b> {facts[fact % facts.length]}
        </p>
      )}
    </div>
  );
}
