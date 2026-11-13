// Acceso al catálogo de destinos. Los datos viven en Supabase (tablas catalog_cities y catalog_must_do): el servidor
// los carga (lib/catalog.ts) y los entrega al navegador (components/CatalogProvider.tsx). Hasta que llegan, o si la
// base no responde, rige la copia de respaldo (lib/catalog.snapshot.ts). Solo las ciudades activas se pueden elegir;
// las inactivas existen (perfil y reglas listos) para mostrar nombres y preparar expansiones.
import { CATALOG_SNAPSHOT } from "@/lib/catalog.snapshot";

export type Region = "us_east" | "us_west" | "europe";

export type CityInfo = {
  code: string;
  name: string;
  country: string;
  region: Region;
  currency: string; // moneda local (ISO 4217), informativa: el motor cotiza en USD
  airports: string[];
  lat: number;
  lon: number;
  mustDo: string[]; // imperdibles en orden de prioridad
  // cuántos imperdibles entran según las noches (índice = noches − 1; el último valor vale para más noches).
  // Medido con el motor en toda posición del recorrido y época del año: pedir más los vuelve infactibles.
  mustDoByNights?: number[];
  sameAreaAs?: string; // comparte aeropuertos con otra ciudad: no se pueden combinar (no hay vuelo entre ambas)
  defaultNights: number;
  active: boolean; // se puede elegir en el buscador
};

export const MAX_CITIES = 4; // mismo tope que el motor (TripRequest.cities): acota la combinatoria de esqueletos

let catalog: CityInfo[] = CATALOG_SNAPSHOT;
let byCode = new Map(catalog.map((c) => [c.code, c]));

/** Reemplaza el catálogo vigente. Una lista vacía se ignora: nunca se queda la web sin destinos. */
export function setCatalog(cities: CityInfo[]): void {
  if (cities.length === 0 || cities === catalog) return;
  catalog = cities;
  byCode = new Map(cities.map((c) => [c.code, c]));
}

/** Ciudades que se pueden elegir, en el orden del catálogo. */
export const activeCities = (): CityInfo[] => catalog.filter((c) => c.active);

/** Cualquier ciudad del catálogo, activa o no (nombres de búsquedas viejas, links compartidos). */
export const cityByCode = (code: string): CityInfo | undefined => byCode.get(code);

/** Imperdibles que caben en esas noches (nunca más días de actividades obligatorias que los de la estadía). */
export function mustDoFor(c: CityInfo, nights: number): string[] {
  const table = c.mustDoByNights;
  if (!table) return c.mustDo;
  return c.mustDo.slice(0, table[Math.min(Math.max(nights, 1), table.length) - 1]);
}

/** Ciudades que no se pueden combinar en un mismo viaje (comparten aeropuertos). */
export const sameArea = (a: CityInfo, b: CityInfo) => a.sameAreaAs === b.code || b.sameAreaAs === a.code;

// Búsqueda sin acentos ni mayúsculas por nombre, país o código ("paris", "italia", "MCO" no; "ORL" sí).
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
export function searchCities(query: string, exclude: string[] = [], limit = 6): CityInfo[] {
  const q = fold(query);
  if (!q) return [];
  const hits = activeCities().filter((c) => !exclude.includes(c.code)
    && (fold(c.name).includes(q) || fold(c.country).includes(q) || c.code.toLowerCase() === q));
  // primero las que empiezan con lo escrito
  return hits.sort((a, b) => Number(!fold(a.name).startsWith(q)) - Number(!fold(b.name).startsWith(q))).slice(0, limit);
}

export const ORIGINS = [{ code: "EZE", name: "Buenos Aires (Ezeiza)", lat: -34.8222, lon: -58.5358 }];

// Alcance de la beta en palabras, a partir de las regiones de las ciudades activas ("la Costa Este y la Costa Oeste de
// EE. UU."). Activar una ciudad de otra región actualiza el aviso sin tocar código.
const LIST = new Intl.ListFormat("es", { type: "conjunction" });
const US_REGION: Partial<Record<Region, string>> = { us_east: "la Costa Este", us_west: "la Costa Oeste" };
export function scopeLabel(cities: CityInfo[]): string {
  const regions = new Set(cities.map((c) => c.region));
  const us = (["us_east", "us_west"] as const).filter((r) => regions.has(r)).map((r) => US_REGION[r]!);
  return LIST.format([...(us.length ? [`${LIST.format(us)} de EE. UU.`] : []), ...(regions.has("europe") ? ["Europa"] : [])]);
}
const cityList = (cities: CityInfo[]) => LIST.format(cities.map((c) => c.name));

// Ciudades activas agrupadas por región, en el orden del catálogo: el aviso de la beta las muestra en renglones
// separados ("Costa Este de EE. UU.: …") para leerlas de un vistazo.
const REGION_TITLE: Record<Region, string> = {
  us_east: "Costa Este de EE. UU.", us_west: "Costa Oeste de EE. UU.", europe: "Europa",
};
const REGION_ORDER: Region[] = ["us_east", "us_west", "europe"];
export function scopeGroups(cities: CityInfo[]): { region: Region; title: string; cities: string }[] {
  return REGION_ORDER.flatMap((region) => {
    const inRegion = cities.filter((c) => c.region === region);
    return inRegion.length ? [{ region, title: REGION_TITLE[region], cities: cityList(inRegion) }] : [];
  });
}
