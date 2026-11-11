// Catálogo de destinos (V1: 7 ciudades de la costa este de EE.UU.). El motor usa el caso de prueba para Orlando + Nueva
// York dentro de sus rangos y genera datos simulados, calibrados al pedido, para cualquier otra combinación.
export type CityInfo = {
  code: string;
  name: string;
  country: string;
  airports: string[];
  lat: number;
  lon: number;
  mustDo: string[]; // imperdibles en orden de prioridad
  // cuántos imperdibles entran según las noches (índice = noches − 1; el último valor vale para más noches).
  // Medido con el motor en toda posición del recorrido y época del año: pedir más los vuelve infactibles.
  mustDoByNights?: number[];
  sameAreaAs?: string; // comparte aeropuertos con otra ciudad: no se pueden combinar (no hay vuelo entre ambas)
  defaultNights: number;
};

export const MAX_CITIES = 4; // mismo tope que el motor (TripRequest.cities): acota la combinatoria de esqueletos

const US = "Estados Unidos";
export const CITIES: CityInfo[] = [
  { code: "NYC", name: "Nueva York", country: US, airports: ["JFK", "LGA", "EWR"], lat: 40.758, lon: -73.9855,
    mustDo: ["SOL", "TOR", "MOMA"], mustDoByNights: [0, 2, 3], defaultNights: 4 },
  { code: "ORL", name: "Orlando", country: US, airports: ["MCO"], lat: 28.3852, lon: -81.5639,
    mustDo: ["MK", "EPCOT", "HS", "AK", "EPIC"], mustDoByNights: [0, 0, 1, 2, 3, 3, 4, 5], defaultNights: 7 },
  { code: "MIA", name: "Miami", country: US, airports: ["MIA"], lat: 25.7617, lon: -80.1918, mustDo: [], defaultNights: 4 },
  { code: "PHL", name: "Filadelfia", country: US, airports: ["PHL"], lat: 39.9526, lon: -75.1652, mustDo: [], defaultNights: 2 },
  { code: "BOS", name: "Boston", country: US, airports: ["BOS"], lat: 42.3601, lon: -71.0589, mustDo: [], defaultNights: 3 },
  { code: "WAS", name: "Washington D.C.", country: US, airports: ["IAD", "DCA"], lat: 38.9072, lon: -77.0369,
    mustDo: [], defaultNights: 3 },
  { code: "BKN", name: "Brooklyn", country: US, airports: ["JFK", "LGA"], lat: 40.6782, lon: -73.9442, mustDo: [],
    sameAreaAs: "NYC", defaultNights: 3 },
];

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
  const hits = CITIES.filter((c) => !exclude.includes(c.code)
    && (fold(c.name).includes(q) || fold(c.country).includes(q) || c.code.toLowerCase() === q));
  // primero las que empiezan con lo escrito
  return hits.sort((a, b) => Number(!fold(a.name).startsWith(q)) - Number(!fold(b.name).startsWith(q))).slice(0, limit);
}

export const ORIGINS = [{ code: "EZE", name: "Buenos Aires (Ezeiza)", lat: -34.8222, lon: -58.5358 }];

const BY_CODE = new Map(CITIES.map((c) => [c.code, c]));
export const cityByCode = (code: string) => BY_CODE.get(code);
