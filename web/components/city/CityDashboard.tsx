"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { MapPoint } from "@/components/city/CityMap";
import { useChosenLodging } from "@/hooks/useChosenLodging";
import { useRoutes } from "@/hooks/useRoutes";
import { AIRPORT_COORDS } from "@/lib/airports";
import { hasCoords, roadTrip } from "@/lib/geo";
import ActivityCatalog from "@/components/city/ActivityCatalog";
import CityEvents from "@/components/city/CityEvents";
import CityHero from "@/components/city/CityHero";
import CityPlaces from "@/components/city/CityPlaces";
import ActivityPlan from "@/components/city/ActivityPlan";
import LodgingFeed from "@/components/city/LodgingFeed";
import SportsTeams from "@/components/city/SportsTeams";
import MobilityWidget from "@/components/city/MobilityWidget";
import WeatherWidget from "@/components/city/WeatherWidget";
import { quotedTransport } from "@/lib/checkout";
import { cityByCode } from "@/lib/cities";
import type { TripRequest } from "@/lib/contracts";
import { fmtDay } from "@/lib/format";
import { fmtMinor } from "@/lib/money";
import type { ActivityOfferRow, ItineraryPayload, TransportQuote, WeatherDay } from "@/lib/types";

type Stay = ItineraryPayload["stays"][number];

// Mapa en diferido y solo en el cliente (Leaflet necesita `window`); mientras carga se reserva su alto.
const CityMap = dynamic(() => import("@/components/city/CityMap"), {
  ssr: false, loading: () => <div className="h-72 animate-pulse rounded-3xl bg-surface" />,
});

// Pantalla 4: se repite por cada ciudad del itinerario.
export default function CityDashboard({ index, stay, req, weather, transport, activities }: {
  index: number; stay: Stay; req: TripRequest; weather: WeatherDay[]; transport: TransportQuote[]; activities: ActivityOfferRow[];
}) {
  const c = req.constraints;
  const on = req.services;
  const lodging = useChosenLodging(stay);
  // Puntos del mapa: alojamiento elegido, las otras propiedades disponibles y las actividades del itinerario; solo
  // los que tienen ubicación real (nada de coordenadas inventadas).
  const points = useMemo<MapPoint[]>(() => [
    ...(stay.lodging_options ?? []).filter((o) => !o.rejection && o.offer_id !== lodging?.offer_id).filter(hasCoords)
      .map((o) => ({ lat: o.lat, lon: o.lon, label: `${o.name} · ${fmtMinor(o.cost_minor ?? 0)}`, kind: "option" as const })),
    ...(hasCoords(lodging) ? [{ lat: lodging.lat, lon: lodging.lon, label: lodging.name, kind: "lodging" as const }] : []),
    ...stay.activities.filter(hasCoords).map((a) => ({ lat: a.lat, lon: a.lon, label: a.name, kind: "activity" as const })),
  ], [lodging, stay.activities, stay.lodging_options]);
  const info = cityByCode(stay.city);
  // Rutas reales por calle desde el alojamiento elegido: a los aeropuertos de la ciudad y a cada actividad.
  // sin vuelos cotizados no hay traslado al aeropuerto que mostrar
  const airports = useMemo(() => (on.flights ? info?.airports ?? [] : []).filter((c) => AIRPORT_COORDS[c]), [on.flights, info]);
  const acts = useMemo(() => stay.activities.filter(hasCoords), [stay.activities]);
  const dests = useMemo(() => [...airports.map((c) => AIRPORT_COORDS[c]), ...acts], [airports, acts]);
  const routes = useRoutes(hasCoords(lodging) ? { lat: lodging.lat, lon: lodging.lon } : null, dests);
  const transfers = useMemo(() => (routes ?? []).slice(0, airports.length).flatMap((r, i) =>
    r ? [{ airport: AIRPORT_COORDS[airports[i]].name, trip: roadTrip(r) }] : []), [routes, airports]);
  const roads = useMemo(() => new Map(acts.flatMap((a, i) => {
    const r = routes?.[airports.length + i];
    return r ? [[a.name, roadTrip(r)] as const] : [];
  })), [routes, acts, airports.length]);
  // Derivados estables (useMemo): los paneles memoizados reciben la misma referencia y no se redibujan cuando solo
  // cambia el alojamiento elegido.
  const days = useMemo(() => weather.filter((w) => w.city === stay.city && w.date >= stay.check_in && w.date < stay.check_out)
    .sort((a, b) => a.date.localeCompare(b.date)), [weather, stay.city, stay.check_in, stay.check_out]);
  const quotes = useMemo(() => quotedTransport(transport, on).filter((t) => t.city === stay.city), [transport, on, stay.city]);
  return (
    <section id={`city-${stay.city}`} aria-labelledby={`city-title-${stay.city}`} className="enter scroll-mt-6 space-y-8">
      {/* Hero del destino: imagen + overlay; compacto para que el contenido útil siga a la vista. */}
      <CityHero lat={info?.lat} lon={info?.lon}>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/85">Destino {index + 1}{info ? ` · ${info.country} · moneda local ${info.currency}` : ""}</p>
          <h2 id={`city-title-${stay.city}`} className="font-display text-3xl font-black tracking-tight drop-shadow sm:text-5xl">
            {info?.name ?? stay.city}
          </h2>
          <p className="mt-1 text-sm text-white/90">{fmtDay(stay.check_in)} → {fmtDay(stay.check_out)} · {stay.nights} noches</p>
        </div>
      </CityHero>

      {info && <CityMap city={stay.city} name={info.name} lat={info.lat} lon={info.lon} points={points} />}

      <div className="grid gap-5 xl:grid-cols-2">
        <WeatherWidget days={days} maxRain={c.max_heavy_rain_prob} maxTmax={c.max_tmax_c} city={stay.city}
          cityName={info?.name ?? stay.city} start={stay.check_in} end={stay.check_out} />
        <MobilityWidget quotes={quotes} costMinor={stay.transport_cost_minor} nights={stay.nights}
          transfers={transfers} />
      </div>

      {stay.lodging_options && (
        <LodgingFeed city={stay.city} cityName={info?.name ?? stay.city} nights={stay.nights} checkIn={stay.check_in}
          checkOut={stay.check_out} pax={req.pax} options={stay.lodging_options} />
      )}

      {on.activities && <ActivityCatalog req={req} city={stay.city} offers={activities} />}
      <CityPlaces city={stay.city} cityName={info?.name ?? stay.city} />
      <CityEvents city={stay.city} cityName={info?.name ?? stay.city} start={stay.check_in} end={stay.check_out} />
      <SportsTeams city={stay.city} cityName={info?.name ?? stay.city} />
      {on.activities && (
        <ActivityPlan stay={stay} lodging={lodging} weather={days} maxRain={c.max_heavy_rain_prob}
          travelDaysFree={c.activity_free_travel_days} roads={roads} />
      )}
    </section>
  );
}
