"use client";

import { useState, useRef } from "react";
import { fmtDay } from "@/lib/format";

type Year = { year: number; tmax_avg_c: number; tmax_max_c: number; heavy_rain_days: number; precip_total_mm: number; days: number };
type Fc = { date: string; tmax_c: number | null; tmin_c: number | null; precip_mm: number | null; precip_prob: number | null };
type Insights = { years: Year[] | null; forecast: Fc[] | null };

const daysUntil = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.now()) / 86_400_000);

// "Ver más" del clima: las mismas fechas en cada uno de los últimos años y el pronóstico actual de la ciudad.
// Se pide recién al abrir (una sola vez) para no gastar llamadas.
export default function WeatherDetail({ city, cityName, start, end }: { city: string; cityName: string; start: string; end: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState(false);

  const loading = useRef(false); // un solo pedido aunque se toque "Ver más" varias veces seguidas

  function toggle() {
    setOpen(!open);
    if (data || error || loading.current) return;
    loading.current = true;
    fetch(`/api/weather?${new URLSearchParams({ city, start, end })}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setError(true))
      .finally(() => { loading.current = false; });
  }

  const years = data?.years ?? [];
  const wetYears = years.filter((y) => y.heavy_rain_days > 0).length;
  const toTrip = daysUntil(start);

  return (
    <div className="mt-4 border-t border-line pt-4">
      <button type="button" onClick={toggle} aria-expanded={open} className="text-sm font-semibold text-accent hover:underline">
        {open ? "Ocultar detalle" : "Ver más: históricos y pronóstico"}
      </button>
      {open && (
        <div className="mt-4 space-y-6 text-sm" data-testid={`weather-detail-${city}`}>
          {error && <p role="alert" className="text-red-700">No pudimos traer el detalle del clima. Probá de nuevo más tarde.</p>}
          {!data && !error && <p className="text-muted">Buscando datos…</p>}

          {data && (
            <section>
              <h5 className="font-semibold text-ink">Tus mismas fechas en años anteriores</h5>
              {years.length === 0 ? <p className="mt-2 text-muted">Sin datos históricos disponibles.</p> : (
                <>
                  <p className="mt-1 text-muted">
                    En {wetYears} de {years.length} años hubo al menos un día de lluvia fuerte (10 mm o más).
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[20rem] text-left text-xs" data-testid="weather-history">
                      <thead className="text-muted">
                        <tr><th className="py-1 font-medium">Año</th><th className="font-medium" title="Máxima promedio">Máx. prom.</th>
                          <th className="font-medium" title="Máxima del período">Máx.</th>
                          <th className="font-medium" title="Días con lluvia fuerte (10 mm o más)">Lluvia fuerte</th>
                          <th className="font-medium" title="Lluvia total del período">Total</th></tr>
                      </thead>
                      <tbody>
                        {[...years].reverse().map((y) => (
                          <tr key={y.year} className="border-t border-line">
                            <td className="py-1.5 font-semibold text-ink">{y.year}</td>
                            <td>{y.tmax_avg_c.toFixed(1)} °C</td>
                            <td>{y.tmax_max_c.toFixed(1)} °C</td>
                            <td>{y.heavy_rain_days} de {y.days}</td>
                            <td>{y.precip_total_mm.toFixed(0)} mm</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          {data && (
            <section>
              <h5 className="font-semibold text-ink">Así está hoy en {cityName}</h5>
              <p className="mt-1 text-muted">
                {toTrip > 7
                  ? `Faltan ${toTrip} días para tu llegada: el pronóstico para tus fechas aparece 7 días antes. Mientras, el de esta semana:`
                  : "Pronóstico de los próximos días:"}
              </p>
              {!data.forecast ? <p className="mt-2 text-muted">Pronóstico no disponible en este momento.</p> : (
                <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                  {data.forecast.map((f) => (
                    <li key={f.date} className="rounded-2xl bg-surface px-2 py-3 text-center">
                      <span className="block text-xs text-muted">{fmtDay(f.date)}</span>
                      <span className="block font-semibold text-ink">{f.tmax_c?.toFixed(0)}° / {f.tmin_c?.toFixed(0)}°</span>
                      <span className="block text-xs text-muted">{f.precip_prob ?? "—"}% lluvia</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <p className="text-xs text-muted">
            Datos meteorológicos:{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline">Open-Meteo.com</a>{" "}
            (CC BY 4.0). Los promedios históricos no garantizan el clima de tu viaje.
          </p>
        </div>
      )}
    </div>
  );
}
