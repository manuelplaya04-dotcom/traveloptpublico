"use client";

import "leaflet/dist/leaflet.css";
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AttributionControl, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import { onMapFocus, type MapFocus } from "@/lib/mapFocus";

// lodging: el alojamiento elegido · option: otras propiedades disponibles de la estadía · activity: del itinerario
export type MapPoint = { lat: number; lon: number; label: string; kind: "lodging" | "option" | "activity" };

const STYLE = {
  lodging: { color: "#4f46e5", fillColor: "#4f46e5", fillOpacity: 0.9, radius: 10 },
  option: { color: "#818cf8", fillColor: "#c7d2fe", fillOpacity: 0.7, radius: 6 },
  activity: { color: "#d97706", fillColor: "#f59e0b", fillOpacity: 0.85, radius: 7 },
} as const;

// Mapa de la ciudad con Leaflet y tiles de OpenStreetMap (gratis, sin API key; la atribución es obligatoria).
// Se carga en diferido y solo en el cliente desde CityDashboard: Leaflet usa `window` y pesa ~40 kB.
// Marca el alojamiento elegido (violeta) y las actividades del itinerario (ámbar), y encuadra todos los puntos.
// Se usan CircleMarker: el Marker por defecto de Leaflet depende de imágenes que los bundlers no resuelven.
export default memo(function CityMap({ city, name, lat, lon, points = [] }: {
  city: string; name: string; lat: number; lon: number; points?: MapPoint[];
}) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div ref={box} className="scroll-mt-6 overflow-hidden rounded-3xl shadow-md print:hidden" data-testid="city-map" data-city={city}>
      {/* Controles propios: los de Leaflet son <a href="#"> (zoom) y un link sin rel (crédito); acá son <button> reales. */}
      {/* Sin animaciones de zoom: si la vista cambia (otra ciudad, impresión) a mitad de una animación, Leaflet intenta
          mover un panel ya desmontado y lanza "_leaflet_pos" en la consola. */}
      <MapContainer key={`${lat},${lon}`} center={[lat, lon]} zoom={12} scrollWheelZoom={false} zoomControl={false}
        zoomAnimation={false} fadeAnimation={false} markerZoomAnimation={false}
        attributionControl={false} className="h-72 w-full" aria-label={`Mapa de ${name}`}>
        <AttributionControl position="bottomright" prefix={false} />
        <ZoomButtons />
        <TileLayer
          url="/api/tiles/{z}/{x}/{y}"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
          maxZoom={18}
        />
        {points.length === 0 && (
          <CircleMarker center={[lat, lon]} radius={10} pathOptions={{ color: "#4f46e5", fillOpacity: 0.35 }}>
            <Tooltip>{name}</Tooltip>
          </CircleMarker>
        )}
        {points.map((p) => <PointMarker key={`${p.kind}-${p.label}`} lat={p.lat} lon={p.lon} kind={p.kind} label={p.label} />)}
        <FitBounds points={points.filter((p) => p.kind !== "option")} />
        <FocusLayer city={city} box={box} />
      </MapContainer>
      {points.length > 0 && (
        <p className="flex gap-4 bg-white px-4 py-2 text-xs text-muted" data-testid="map-legend">
          <span><span aria-hidden className="mr-1 inline-block size-2.5 rounded-full bg-accent" />Alojamiento</span>
          {points.some((p) => p.kind === "option") && (
            <span><span aria-hidden className="mr-1 inline-block size-2.5 rounded-full bg-indigo-200 ring-1 ring-indigo-400" />Otras opciones</span>
          )}
          <span><span aria-hidden className="mr-1 inline-block size-2.5 rounded-full bg-amber-500" />Actividades</span>
          <span className="ml-auto">Ubicaciones aproximadas</span>
        </p>
      )}
    </div>
  );
});

// Un punto del mapa. Memoizado y con coordenadas primitivas: react-leaflet compara `center` por referencia y, con un
// array nuevo en cada render, movería (setLatLng) todos los marcadores al elegir otro alojamiento. Así solo se
// actualizan los que cambiaron.
const PointMarker = memo(function PointMarker({ lat, lon, kind, label }: MapPoint) {
  const center = useMemo<[number, number]>(() => [lat, lon], [lat, lon]);
  return (
    <CircleMarker center={center} radius={STYLE[kind].radius} pathOptions={STYLE[kind]}>
      <Tooltip>{label}</Tooltip>
    </CircleMarker>
  );
});

// Encuadra el mapa para que entren el alojamiento y todas las actividades (solo cuando cambian los puntos).
function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat},${p.lon}`).join("|");
  const first = useRef(true);
  useEffect(() => {
    if (points.length < 2) return;
    const fit = () => map.fitBounds(points.map((p) => [p.lat, p.lon] as [number, number]),
      { padding: [32, 32], maxZoom: 14, animate: false });
    if (first.current) { // al montar, encuadre directo (no hay clic en curso)
      first.current = false;
      fit();
      return;
    }
    // Después (p. ej. se eligió otro alojamiento): solo si algún punto quedó fuera de la vista, y en el cuadro siguiente.
    // Reencuadrar reconstruye la grilla de mosaicos de Leaflet; hacerlo dentro del clic lo demoraba cientos de ms.
    if (points.every((p) => map.getBounds().contains([p.lat, p.lon]))) return;
    const frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` resume los puntos; evita reencuadrar en cada render
  }, [map, key]);
  return null;
}

const FOCUS_ZOOM = 15;
const FOCUS_RING = { color: "#e11d48", weight: 3, fillColor: "#fb7185", fillOpacity: 0.25 } as const;

// "Ver en mapa": escucha los pedidos de esta ciudad (lib/mapFocus), trae el mapa a la vista, vuela hasta el punto y
// lo resalta. El estado vive solo acá: la lista de tarjetas no se entera. La animación es la de Leaflet (frames
// propios, fuera del render de React); sin animación si la persona pidió movimiento reducido.
// `_leaflet_pos`: flyTo/setView cortan solos el vuelo anterior y map.remove() (al desmontar) cancela el frame en curso.
// NO llamar map.stop() en la limpieza: después de remove() hace setZoom sobre un panel borrado y lanza justo ese error.
function FocusLayer({ city, box }: { city: string; box: RefObject<HTMLDivElement | null> }) {
  const map = useMap();
  const [focus, setFocus] = useState<MapFocus | null>(null);
  useEffect(() => {
    const off = onMapFocus(city, (f) => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      box.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      const zoom = Math.max(map.getZoom(), FOCUS_ZOOM);
      if (reduce) map.setView([f.lat, f.lon], zoom, { animate: false });
      else map.flyTo([f.lat, f.lon], zoom, { duration: 0.8 });
      setFocus(f);
    });
    return off;
  }, [city, map, box]);
  if (!focus) return null;
  return (
    <>
      {/* `className` va como opción de Leaflet (se lee al crear el path): dentro de `pathOptions` react-leaflet lo aplica
          con setStyle, que no asigna clases, y el anillo quedaba sin su clase. */}
      <CircleMarker key={`${focus.lat},${focus.lon}`} center={[focus.lat, focus.lon]} radius={16} interactive={false}
        className="map-focus-ring" pathOptions={FOCUS_RING}>
        <Tooltip permanent direction="top" offset={[0, -14]}>{focus.label}</Tooltip>
      </CircleMarker>
      <div className="sr-only" aria-live="polite" data-testid="map-focus-status">Mostrando en el mapa: {focus.label}</div>
    </>
  );
}

// Zoom con <button> accesibles (sin enlaces vacíos), encima del mapa.
function ZoomButtons() {
  const map = useMap();
  const btn = "flex size-8 items-center justify-center bg-white text-lg font-bold text-ink hover:bg-surface";
  return (
    <div className="leaflet-top leaflet-left">
      <div className="leaflet-control overflow-hidden rounded-lg shadow-md">
        <button type="button" aria-label="Acercar el mapa" className={btn} onClick={() => map.zoomIn()}>+</button>
        <button type="button" aria-label="Alejar el mapa" className={`${btn} border-t border-line`} onClick={() => map.zoomOut()}>−</button>
      </div>
    </div>
  );
}
