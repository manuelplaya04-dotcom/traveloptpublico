import type { CityInfo } from "@/lib/cities";

// Copia de respaldo del catálogo (tablas catalog_cities y catalog_must_do de Supabase). La fuente de verdad es la base:
// esto solo se usa si no responde, para que la web nunca quede sin destinos. test/catalog.test.ts verifica que coincida
// con lo que siembran las migraciones, así que no se puede editar una sin la otra.
const US = { country: "Estados Unidos", currency: "USD" } as const;
const EAST = { ...US, region: "us_east" } as const;
const WEST = { ...US, region: "us_west" } as const;
const SPAIN = { country: "España", currency: "EUR", region: "europe" } as const;
const PATAGONIA = { country: "Argentina", currency: "ARS", region: "ar_patagonia" } as const;
const BRAZIL = { country: "Brasil", currency: "BRL", region: "br_coast" } as const;

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
  { code: "MAD", name: "Madrid", ...SPAIN, airports: ["MAD"], lat: 40.4168, lon: -3.7038, mustDo: [], defaultNights: 4,
    active: false },
  { code: "BCN", name: "Barcelona", ...SPAIN, airports: ["BCN"], lat: 41.3874, lon: 2.1686, mustDo: [], defaultNights: 4,
    active: false },
  { code: "IBZ", name: "Ibiza", ...SPAIN, airports: ["IBZ"], lat: 38.9067, lon: 1.4206, mustDo: [], defaultNights: 4,
    active: false },
  { code: "TFE", name: "Tenerife", ...SPAIN, airports: ["TFS", "TFN"], lat: 28.4636, lon: -16.2518, mustDo: [],
    defaultNights: 5, active: false },
  { code: "AMS", name: "Ámsterdam", country: "Países Bajos", currency: "EUR", region: "europe", airports: ["AMS"],
    lat: 52.3676, lon: 4.9041, mustDo: [], defaultNights: 3, active: false },
  { code: "BRG", name: "Brujas", country: "Bélgica", currency: "EUR", region: "europe", airports: ["BRU"],
    lat: 51.2093, lon: 3.2247, mustDo: [], defaultNights: 2, active: false },
  // Patagonia argentina y costa de Brasil: las ciudades con `sameAreaAs` se visitan desde el aeropuerto de otra.
  { code: "BAR", name: "Bariloche", ...PATAGONIA, airports: ["BRC"], lat: -41.1335, lon: -71.3103, mustDo: [],
    defaultNights: 5, active: true },
  { code: "SMA", name: "San Martín de los Andes", ...PATAGONIA, airports: ["CPC"], lat: -40.1575, lon: -71.3532,
    mustDo: [], defaultNights: 4, active: true },
  { code: "VLA", name: "Villa La Angostura", ...PATAGONIA, airports: ["BRC"], lat: -40.7616, lon: -71.6463, mustDo: [],
    sameAreaAs: "BAR", defaultNights: 3, active: true },
  { code: "VPH", name: "Villa Pehuenia", ...PATAGONIA, airports: ["CPC", "NQN"], lat: -38.8829, lon: -71.1719,
    mustDo: [], sameAreaAs: "SMA", defaultNights: 3, active: true },
  { code: "RIO", name: "Río de Janeiro", ...BRAZIL, airports: ["GIG", "SDU"], lat: -22.9068, lon: -43.1729, mustDo: [],
    defaultNights: 5, active: true },
  { code: "SSA", name: "Salvador", ...BRAZIL, airports: ["SSA"], lat: -12.9777, lon: -38.5016, mustDo: [],
    defaultNights: 5, active: true },
  { code: "MCZ", name: "Maceió", ...BRAZIL, airports: ["MCZ"], lat: -9.6658, lon: -35.7353, mustDo: [],
    defaultNights: 5, active: true },
  { code: "AJU", name: "Aracaju", ...BRAZIL, airports: ["AJU"], lat: -10.9472, lon: -37.0731, mustDo: [],
    defaultNights: 4, active: true },
  { code: "CNV", name: "Canasvieiras", ...BRAZIL, airports: ["FLN"], lat: -27.4297, lon: -48.4617, mustDo: [],
    defaultNights: 7, active: true },
  { code: "BUZ", name: "Búzios", ...BRAZIL, airports: ["CFB", "GIG"], lat: -22.7469, lon: -41.8817, mustDo: [],
    sameAreaAs: "RIO", defaultNights: 4, active: true },
  { code: "CFR", name: "Cabo Frío", ...BRAZIL, airports: ["CFB", "GIG"], lat: -22.8794, lon: -42.0186, mustDo: [],
    sameAreaAs: "RIO", defaultNights: 3, active: true },
  { code: "ARC", name: "Arraial do Cabo", ...BRAZIL, airports: ["CFB", "GIG"], lat: -22.9661, lon: -42.0278, mustDo: [],
    sameAreaAs: "RIO", defaultNights: 3, active: true },
  { code: "CAM", name: "Camaçari", ...BRAZIL, airports: ["SSA"], lat: -12.6996, lon: -38.3263, mustDo: [],
    sameAreaAs: "SSA", defaultNights: 3, active: true },
  { code: "ARA", name: "Arapiraca", ...BRAZIL, airports: ["MCZ"], lat: -9.7525, lon: -36.6611, mustDo: [],
    sameAreaAs: "MCZ", defaultNights: 2, active: true },
];
