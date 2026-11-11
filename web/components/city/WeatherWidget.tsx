"use client";

import dynamic from "next/dynamic";
import WeatherIcon from "@/components/ui/WeatherIcon";
import { fmtDay, weatherKind, weatherSource } from "@/lib/format";
import type { WeatherDay } from "@/lib/types";

// El "Ver más" (históricos y pronóstico) se descarga recién cuando la tarjeta se muestra.
const WeatherDetail = dynamic(() => import("@/components/city/WeatherDetail"));

// Clima por día de la estadía + una recomendación para la valija. Marca los días que tus condiciones vetan para
// actividades al aire libre (mismo umbral que el motor).
export default function WeatherWidget({ days, maxRain, maxTmax, city, cityName, start, end }: {
  days: WeatherDay[]; maxRain: number; maxTmax: number; city: string; cityName: string; start: string; end: string;
}) {
  if (days.length === 0) {
    return (
      <Widget title="Clima">
        <p className="text-sm text-muted">Sin datos de clima de la corrida para estas fechas.</p>
        <WeatherDetail city={city} cityName={cityName} start={start} end={end} />
      </Widget>
    );
  }
  const temps = days.map((d) => d.tmax_c);
  const rainy = days.filter((d) => d.heavy_rain_prob > maxRain).length;
  const [lo, hi] = [Math.min(...temps).toFixed(0), Math.max(...temps).toFixed(0)];
  const tip = [
    lo === hi ? `Máximas de ${hi} °C` : `Máximas entre ${lo} y ${hi} °C`,
    rainy ? `${rainy} día${rainy > 1 ? "s" : ""} con lluvia fuerte probable: sumá piloto o paraguas` : "sin días de lluvia fuerte probable",
  ].join(" · ");

  return (
    <Widget title="Clima" subtitle={weatherSource(days[0].source)}>
      <p className="text-sm text-ink">{tip}.</p>
      <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-2">
        {days.map((d) => {
          const vetoed = d.heavy_rain_prob > maxRain || d.tmax_c > maxTmax;
          return (
            <li key={d.date} title={vetoed ? "Sin actividades al aire libre ese día" : undefined}
              className={`flex flex-col items-center rounded-2xl px-1 py-3 text-center ${vetoed ? "bg-amber-50 ring-1 ring-amber-200" : "bg-surface"}`}>
              <span className="text-xs text-muted">{fmtDay(d.date)}</span>
              <WeatherIcon kind={weatherKind(d.heavy_rain_prob, maxRain)} className="mt-1" />
              <span className="font-display text-base font-extrabold text-ink">{d.tmax_c.toFixed(0)}°</span>
              <span className={`text-xs ${vetoed ? "font-semibold text-amber-800" : "text-muted"}`}>
                {Math.round(d.heavy_rain_prob * 100)}% lluvia
              </span>
            </li>
          );
        })}
      </ul>
      <WeatherDetail city={city} cityName={cityName} start={start} end={end} />
    </Widget>
  );
}

export function Widget({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-3xl bg-white p-6 shadow-sm">
      <h4 className="font-display text-lg font-bold text-ink">{title}</h4>
      {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
