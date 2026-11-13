import type { CityInfo } from "@/lib/cities";

// Copia de respaldo del catálogo (tablas catalog_cities y catalog_must_do de Supabase). La fuente de verdad es la base:
// esto solo se usa si no responde, para que la web nunca quede sin destinos. test/catalog.test.ts verifica que coincida
// con lo que siembran las migraciones, así que no se puede editar una sin la otra.
const US = { country: "Estados Unidos", currency: "USD" } as const;
const EAST = { ...US, region: "us_east" } as const;
const WEST = { ...US, region: "us_west" } as const;

export const CATALOG_SNAPSHOT: CityInfo[] = [
  { code: "NYC", name: "Nueva York", ...EAST, airports: ["JFK", "LGA", "EWR"], lat: 40.758, lon: -73.9855,
    mustDo: ["SOL", "TOR", "MOMA"], mustDoByNights: [0, 2, 3], defaultNights: 4, active: true },
  { code: "ORL", name: "Orlando", ...EAST, airports: ["MCO"], lat: 28.3852, lon: -81.5639,
    mustDo: ["MK", "EPCOT", "HS", "AK", "EPIC"], mustDoByNights: [0, 0, 1, 2, 3, 3, 4, 5], defaultNights: 7, active: true },
  { code: "MIA", name: "Miami", ...EAST, airports: ["MIA"], lat: 25.7617, lon: -80.1918, mustDo: [], defaultNights: 4,
    active: true },
  { code: "PHL", name: "Filadelfia", ...EAST, airports: ["PHL"], lat: 39.9526, lon: -75.1652, mustDo: [],
    defaultNights: 2, active: true },
  { code: "BOS", name: "Boston", ...EAST, airports: ["BOS"], lat: 42.3601, lon: -71.0589, mustDo: [], defaultNights: 3,
    active: true },
  { code: "WAS", name: "Washington D.C.", ...EAST, airports: ["IAD", "DCA"], lat: 38.9072, lon: -77.0369, mustDo: [],
    defaultNights: 3, active: true },
  { code: "BKN", name: "Brooklyn", ...EAST, airports: ["JFK", "LGA"], lat: 40.6782, lon: -73.9442, mustDo: [],
    sameAreaAs: "NYC", defaultNights: 3, active: true },
  { code: "LAX", name: "Los Ángeles", ...WEST, airports: ["LAX", "BUR", "SNA"], lat: 34.0522, lon: -118.2437,
    mustDo: [], defaultNights: 4, active: true },
  { code: "SFO", name: "San Francisco", ...WEST, airports: ["SFO", "OAK"], lat: 37.7749, lon: -122.4194, mustDo: [],
    defaultNights: 3, active: true },
  { code: "LAS", name: "Las Vegas", ...WEST, airports: ["LAS"], lat: 36.1147, lon: -115.1728, mustDo: [],
    defaultNights: 3, active: true },
  { code: "LON", name: "Londres", country: "Reino Unido", currency: "GBP", region: "europe",
    airports: ["LHR", "LGW", "STN", "LTN", "LCY"], lat: 51.508, lon: -0.1281, mustDo: [], defaultNights: 4, active: false },
  { code: "PAR", name: "París", country: "Francia", currency: "EUR", region: "europe", airports: ["CDG", "ORY"],
    lat: 48.8566, lon: 2.3522, mustDo: [], defaultNights: 4, active: false },
];
