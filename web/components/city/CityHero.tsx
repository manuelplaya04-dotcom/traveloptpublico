import type { ReactNode } from "react";

// Hero del destino: imagen de fondo + overlay oscuro → transparente, con el texto siempre sobre la zona oscura
// (blanco sobre negro/75 ≥ 10:1, WCAG AAA). Sin proveedor de fotos con licencia todavía, la imagen por defecto es un
// mosaico de OpenStreetMap centrado en la ciudad (gratis, con atribución); `photo` la reemplaza cuando exista.
const ZOOM = 12;
const COLS = 4;
const ROWS = 2;

/** Tile de OpenStreetMap (esquema XYZ "slippy map") que contiene un punto. */
export function tileOf(lat: number, lon: number, z = ZOOM) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}

// Sin coordenadas (ciudad fuera del catálogo) no se inventa una ubicación: queda el fondo liso con el overlay.
export default function CityHero({ lat, lon, photo, children }: {
  lat?: number; lon?: number; photo?: string; children: ReactNode;
}) {
  const c = lat !== undefined && lon !== undefined ? tileOf(lat, lon) : undefined;
  const tiles = !c ? [] : Array.from({ length: COLS * ROWS }, (_, i) => ({
    x: c.x - Math.floor(COLS / 2) + (i % COLS),
    y: c.y - Math.floor(ROWS / 2) + Math.floor(i / COLS),
  }));
  return (
    <header className="relative isolate overflow-hidden rounded-3xl bg-ink shadow-md" data-testid="city-hero">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagen decorativa externa, sin optimizador
        <img src={photo} alt="" className="absolute inset-0 -z-10 size-full object-cover" />
      ) : c && (
        <div aria-hidden className="absolute inset-0 -z-10 grid grid-cols-4 grid-rows-2 opacity-90 saturate-150">
          {tiles.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element -- tiles de OSM: ya son PNG chicos y cacheados
            <img key={`${t.x}-${t.y}`} src={`/api/tiles/${ZOOM}/${t.x}/${t.y}`} alt=""
              loading="lazy" decoding="async" className="size-full object-cover" />
          ))}
        </div>
      )}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-black/80 via-black/55 to-black/10" />
      <div className="flex min-h-40 items-end px-6 py-6 text-white sm:min-h-48 sm:px-8">{children}</div>
      {!photo && c && (
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
          className="absolute bottom-1.5 right-3 text-[10px] text-white/80 hover:text-white">© OpenStreetMap</a>
      )}
    </header>
  );
}
