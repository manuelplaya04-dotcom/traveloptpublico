"use client";

import { useEffect, useState } from "react";
import type { LatLon } from "@/lib/geo";

export type RoadRoute = { distance_m: number; duration_s: number } | null;

// Rutas reales por calle desde `origin` a cada destino (OSRM vía motor). null mientras carga o si falla: quien lo usa
// cae a la estimación en línea recta (marcada como estimada). Se pide de nuevo solo si cambian los puntos.
export function useRoutes(origin: LatLon | null, destinations: LatLon[]): RoadRoute[] | null {
  const [routes, setRoutes] = useState<{ key: string; routes: RoadRoute[] } | null>(null);
  const key = origin && destinations.length
    ? JSON.stringify([origin.lat, origin.lon, destinations.map((d) => [d.lat, d.lon])]) : "";
  useEffect(() => {
    if (!key) return;
    const [lat, lon, ds] = JSON.parse(key) as [number, number, [number, number][]];
    const ctl = new AbortController();
    fetch("/api/routes", {
      method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin: { lat, lon }, destinations: ds.map(([a, b]) => ({ lat: a, lon: b })) }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { routes?: RoadRoute[] } | null) => { if (Array.isArray(d?.routes)) setRoutes({ key, routes: d.routes }); })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [key]);
  return routes?.key === key ? routes.routes : null;
}
