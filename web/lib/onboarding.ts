// Estado del onboarding → TripRequest (contrato del motor). Funciones puras: se testean sin React.
import { cityByCode, MAX_CITIES, mustDoFor, sameArea } from "@/lib/cities";
import { constraintsSchema, tripRequestSchema, type Constraints, type TripRequest } from "@/lib/contracts";
import { addDays, diffDays, isIsoDate, MAX_DAYS_AHEAD, todayIso } from "@/lib/dates";
import demoCase from "@/lib/demo-case.json";
import { minorToUnits, toMinor } from "@/lib/money";

const DEMO: TripRequest = tripRequestSchema.parse(demoCase);

// Topes del contrato (CityPlan y TripRequest en el motor).
export const NIGHTS_PER_CITY = { min: 1, max: 21 } as const;
export const TRIP_NIGHTS = { min: 1, max: 60 } as const;
export const PAX = { min: 1, max: 9 } as const;

// Noches asignadas a cada ciudad: la suma tiene que coincidir con la duración del viaje.
export type CityStop = { code: string; nights: number };

// Fechas: se guardan la ida y la duración; la vuelta se DERIVA (ida + noches), así nunca puede quedar incongruente.
export type OnboardingState = {
  origin: string;
  cities: CityStop[]; // en orden de visita
  departDate: string; // primera noche del viaje (el vuelo puede salir la noche anterior)
  flexDays: number; // la ida puede correrse hasta N días más tarde (el motor prueba cada día)
  totalNights: number;
  pax: number;
  budget: number; // USD (unidades); se pasa a centavos al construir el pedido
  constraints: Constraints;
};

// Reparto del óptimo golden (expected.json: "ORL-NYC|2027-07-08|8-4"). Con las noches fijas el motor llega al mismo
// óptimo que con los rangos del caso (USD 20,083.62), así que "Cargar caso de ejemplo" sigue reproduciendo el golden.
const GOLDEN_NIGHTS: Record<string, number> = { ORL: 8, NYC: 4 };

// Caso de ejemplo (golden): se carga a pedido desde el formulario y lo usan los tests de punta a punta.
export const GOLDEN: OnboardingState = {
  origin: DEMO.origin_airports[0],
  cities: DEMO.cities.map((c) => ({ code: c.code, nights: GOLDEN_NIGHTS[c.code] ?? c.min_nights })),
  departDate: DEMO.first_checkin_from,
  flexDays: diffDays(DEMO.first_checkin_from, DEMO.first_checkin_to),
  totalNights: DEMO.total_nights_min,
  pax: DEMO.pax,
  budget: minorToUnits(DEMO.budget_minor),
  constraints: DEMO.constraints,
};

/** Estado de un viaje nuevo: sin destinos y saliendo hoy (fecha de la persona, nunca una fija). */
export function initialState(today = todayIso()): OnboardingState {
  return { origin: DEMO.origin_airports[0], cities: [], departDate: today, flexDays: 0, totalNights: 7, pax: 2,
    budget: 5000, constraints: DEMO.constraints };
}

export type StepErrors = { destinations: string[]; dates: string[]; preferences: string[] };

// Un <input type="number"> vacío o con texto llega como NaN: se rechaza acá en vez de romper al construir el pedido.
const intIn = (v: number, r: { min: number; max: number }) => Number.isInteger(v) && v >= r.min && v <= r.max;

export const assignedNights = (cities: CityStop[]) => cities.reduce((a, c) => a + c.nights, 0);

export const FLEX_DAYS = { min: 0, max: 3 } as const;

/** Toggle de destino: si está, se quita; si no, se agrega al final (hasta MAX_CITIES). Si el reparto venía cuadrado
 *  (o no había destinos), la duración acompaña el cambio para que la suma siga coincidiendo. */
export function toggleCity(s: OnboardingState, code: string): Partial<OnboardingState> {
  const chosen = s.cities.some((c) => c.code === code);
  const info = cityByCode(code);
  if (!chosen && (!info || s.cities.length >= MAX_CITIES)) return {};
  return withCities(s, chosen ? s.cities.filter((c) => c.code !== code) : [...s.cities, { code, nights: info!.defaultNights }]);
}

/** Cambia los destinos o sus noches; si el reparto venía cuadrado (o no había destinos), la duración acompaña. */
export function withCities(s: OnboardingState, cities: CityStop[]): Partial<OnboardingState> {
  const synced = s.cities.length === 0 || assignedNights(s.cities) === s.totalNights;
  const total = assignedNights(cities);
  return synced && intIn(total, TRIP_NIGHTS) ? { cities, totalNights: total } : { cities };
}

/** Fecha de vuelta: ida + noches. Indefinida mientras alguno de los dos datos no sea válido. */
export function returnDate(s: Pick<OnboardingState, "departDate" | "totalNights">): string | undefined {
  return isIsoDate(s.departDate) && intIn(s.totalNights, TRIP_NIGHTS) ? addDays(s.departDate, s.totalNights) : undefined;
}

/** Límites del selector de vuelta: entre 1 y 60 noches después de la ida. */
export function returnBounds(departDate: string) {
  return isIsoDate(departDate)
    ? { min: addDays(departDate, TRIP_NIGHTS.min), max: addDays(departDate, TRIP_NIGHTS.max) }
    : undefined;
}

/** Elegir la vuelta recalcula la duración y ajusta la última ciudad para que el reparto siga sumando. */
export function withReturnDate(s: OnboardingState, iso: string): Partial<OnboardingState> {
  if (!isIsoDate(iso) || !isIsoDate(s.departDate)) return {};
  const totalNights = diffDays(s.departDate, iso);
  if (!intIn(totalNights, TRIP_NIGHTS)) return {};
  const delta = totalNights - s.totalNights;
  const last = s.cities.at(-1);
  if (!last || !intIn(last.nights + delta, NIGHTS_PER_CITY) || assignedNights(s.cities) !== s.totalNights) {
    return { totalNights };
  }
  return { totalNights, cities: [...s.cities.slice(0, -1), { ...last, nights: last.nights + delta }] };
}

export function validate(s: OnboardingState, today = todayIso()): StepErrors {
  const e: StepErrors = { destinations: [], dates: [], preferences: [] };
  const name = (code: string) => cityByCode(code)?.name ?? code;

  if (s.cities.length === 0) e.destinations.push("Elegí al menos un destino.");
  if (s.cities.length > MAX_CITIES) e.destinations.push(`Podés elegir hasta ${MAX_CITIES} destinos.`);
  for (const c of s.cities) {
    if (!cityByCode(c.code)) e.destinations.push(`Destino desconocido: ${c.code}.`);
    else if (!intIn(c.nights, NIGHTS_PER_CITY)) {
      e.destinations.push(`${name(c.code)}: entre ${NIGHTS_PER_CITY.min} y ${NIGHTS_PER_CITY.max} noches.`);
    }
  }
  const infos = s.cities.map((c) => cityByCode(c.code)).filter((c) => c !== undefined);
  for (const [i, a] of infos.entries()) {
    const b = infos.slice(i + 1).find((x) => sameArea(a, x));
    if (b) e.destinations.push(`${b.name} y ${a.name} comparten aeropuertos: elegí una sola (no hay vuelo entre ambas).`);
  }
  if (!intIn(s.totalNights, TRIP_NIGHTS)) {
    e.destinations.push(`La duración del viaje tiene que ser de ${TRIP_NIGHTS.min} a ${TRIP_NIGHTS.max} noches.`);
  } else if (s.cities.length && e.destinations.length === 0) {
    const diff = s.totalNights - assignedNights(s.cities);
    if (diff !== 0) {
      e.destinations.push(`Asignaste ${assignedNights(s.cities)} noches y el viaje dura ${s.totalNights}: ` +
        (diff > 0 ? `te falta repartir ${diff}.` : `sobran ${-diff}.`));
    }
  }

  if (!isIsoDate(s.departDate)) e.dates.push("Elegí una fecha de ida válida.");
  else if (s.departDate < today) e.dates.push("La fecha de ida no puede estar en el pasado.");
  else if (s.departDate > addDays(today, MAX_DAYS_AHEAD)) e.dates.push("Podés planificar hasta 2 años adelante.");
  if (!intIn(s.flexDays, FLEX_DAYS)) e.dates.push(`La flexibilidad va de ${FLEX_DAYS.min} a ${FLEX_DAYS.max} días.`);
  if (!intIn(s.pax, PAX)) e.dates.push(`Entre ${PAX.min} y ${PAX.max} viajeros.`);
  if (!Number.isFinite(s.budget) || s.budget <= 0) e.dates.push("Indicá un presupuesto mayor a cero.");

  // Preferencias: los topes salen del contrato (constraintsSchema), no se repiten acá.
  const prefs = constraintsSchema.safeParse(s.constraints);
  if (!prefs.success) {
    const fields = new Set(prefs.error.issues.map((i) => String(i.path[0])));
    for (const f of fields) e.preferences.push(`${PREFERENCE_LABEL[f] ?? f}: valor fuera de rango.`);
  }
  return e;
}

const PREFERENCE_LABEL: Record<string, string> = {
  min_bathrooms: "Baños mínimos",
  max_stops: "Escalas máximas",
  checked_bags_per_pax: "Valijas despachadas por persona",
  max_heavy_rain_prob: "Lluvia máxima (0 a 1)",
};

export const hasErrors = (e: StepErrors) => Object.values(e).some((list) => list.length > 0);

export function buildTripRequest(s: OnboardingState): TripRequest {
  return tripRequestSchema.parse({
    case_key: null, // el motor reconoce solo su caso de prueba (ruta, fechas y noches): la web no conoce datos de prueba
    origin_airports: [s.origin],
    cities: s.cities.map((c) => {
      const info = cityByCode(c.code);
      if (!info) throw new Error(`Destino desconocido: ${c.code}`);
      return { code: info.code, name: info.name, airports: info.airports, lat: info.lat, lon: info.lon,
        min_nights: c.nights, max_nights: c.nights, must_do: mustDoFor(info, c.nights) };
    }),
    fixed_order: true, // el orden lo elige el usuario
    first_checkin_from: s.departDate,
    first_checkin_to: addDays(s.departDate, s.flexDays),
    total_nights_min: s.totalNights,
    total_nights_max: s.totalNights,
    pax: s.pax,
    budget_minor: toMinor(s.budget),
    currency: DEMO.currency,
    constraints: s.constraints,
    top_n: DEMO.top_n,
  });
}

/** Días de actividades que pide una selección (día completo = 1, medio día = ½) contra los días disponibles. */
export function activityLoad(chosen: { slots: number }[], availableDays: number) {
  const days = chosen.reduce((a, c) => a + c.slots, 0) / 2;
  return { days, availableDays, fits: days <= availableDays };
}
