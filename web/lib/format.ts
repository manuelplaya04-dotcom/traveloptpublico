// Formatos de presentación (sin lógica de negocio).
const AIRLINES: Record<string, string> = {
  AA: "American Airlines", AR: "Aerolíneas Argentinas", AV: "Avianca", B6: "JetBlue",
  CM: "Copa Airlines", DL: "Delta", LA: "LATAM", UA: "United", AF: "Air France", IB: "Iberia",
};
export const airlineName = (code: string) => AIRLINES[code] ?? code;

// Proveedores de la demo: el caso de prueba y los datos simulados del motor (no son precios reales).
export const isDemoProvider = (provider: string) => provider === "fixture" || provider === "simulado";

// Las fechas del motor son locales sin zona: se formatean en UTC para no correrlas de día.
// Un solo formateador por módulo: `toLocaleDateString` con opciones arma uno nuevo en cada llamada (~40 veces más lento),
// y fmtDay se llama por cada fila de cada calendario y tarjeta.
const DAY_FORMAT = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const fmtDay = (isoDate: string) => DAY_FORMAT.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`));
// Clima de un día para íconos y alertas (mismo umbral que el motor para actividades al aire libre).
export type WeatherKind = "storm" | "cloud" | "sun";
export const weatherKind = (rainProb: number, maxRain: number): WeatherKind =>
  rainProb > maxRain ? "storm" : rainProb > 0.3 ? "cloud" : "sun";

export const fmtTime = (iso: string) => iso.slice(11, 16);

// Días de calendario entre salida y llegada, en horas locales: +1 si llega al día siguiente, +2 si salta un día (Los
// Ángeles → Sídney), −1 si llega "el día anterior" por la línea de cambio de fecha. 0 si alguna fecha no es válida.
export function dayOffset(departAt: string, arriveAt: string): number {
  const diff = Date.parse(`${arriveAt.slice(0, 10)}T00:00:00Z`) - Date.parse(`${departAt.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(diff) ? Math.round(diff / 86_400_000) : 0;
}
export const fmtDayOffset = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "");

// Duración real del vuelo: "5 h 20 min". Vacío si no se conoce (nunca se resta entre horas locales de husos distintos).
export function fmtDuration(min: number | null | undefined): string {
  if (!min || min <= 0) return "";
  const [h, m] = [Math.floor(min / 60), min % 60];
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

export function sourceName(deeplink: string | null): string | null {
  if (!deeplink) return null;
  try {
    const host = new URL(deeplink).hostname.replace(/^www\./, "");
    return host === "google.com" ? "Google Flights" : host;
  } catch {
    return null;
  }
}

export const REJECTION_LABEL: Record<string, string> = {
  "flight.too_many_stops": "Más escalas que tu máximo",
  "flight.departs_too_early": "Sale antes de tu hora mínima",
  "flight.arrives_too_late": "Llega después de tu hora máxima",
  "flight.insufficient_seats": "No hay asientos para todo el grupo",
  "lodging.short_term_not_legal": "Alquiler temporario no legal en la ciudad",
  "lodging.min_nights": "Exige más noches de las planificadas",
  "lodging.capacity": "No entra todo el grupo",
  "lodging.bathrooms": "Menos baños que tu mínimo",
  "lodging.bedrooms": "Menos dormitorios que tu mínimo",
  "lodging.no_kitchen": "No tiene cocina",
  "lodging.kitchen_unknown": "No informa si tiene cocina",
  "lodging.no_unit_combination": "Ninguna combinación de unidades cumple tus condiciones",
};

export const TRANSPORT_MODE: Record<string, string> = { car_rental: "Alquiler de auto", transfers: "Traslados" };

// Fuente legible del clima que usó el motor ("open_meteo_climatology:2016-2025", "openweather_onecall", "fixture_…").
export function weatherSource(source: string): string {
  if (source.startsWith("fixture")) return "Datos de ejemplo (modo de prueba)";
  if (source.startsWith("demo")) return "Clima simulado (demo)";
  if (source.startsWith("openweather")) return "Pronóstico (OpenWeather)";
  const years = source.split(":")[1]?.replace("-", "–");
  return `Promedio histórico${years ? ` ${years}` : ""} (Open-Meteo)`;
}

// Noches de una estadía: del check-in al día anterior al check-out (fechas locales sin zona).
export function stayDays(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let t = new Date(`${checkIn}T00:00:00Z`); t < new Date(`${checkOut}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1)) {
    out.push(t.toISOString().slice(0, 10));
  }
  return out;
}

// Avisos de degradación (norma 4): qué datos no críticos faltaron y qué implica para el itinerario.
const DEGRADED_NOTICE: Record<string, string> = {
  weather: "No pudimos consultar el clima. Las actividades al aire libre se muestran sin verificar lluvia ni calor.",
  activities: "No pudimos consultar las actividades. Tu itinerario incluye vuelos, alojamiento y traslados, sin actividades.",
};

// Cuota de SerpApi agotada: el motor sirvió los últimos precios reales guardados en vez de consultar en vivo.
export const HISTORICAL_NOTICE =
  "Mostrando precios históricos guardados (cuota en vivo agotada). Cada tarjeta indica cuándo se cotizó; " +
  "confirmá el precio final en el sitio del proveedor.";

// Búsquedas de vuelos o alojamiento que fallaron sin dato guardado: el itinerario usa las que respondieron.
const PARTIAL_NOTICE: Record<string, string> = {
  flights: "No pudimos cotizar algunas fechas de vuelos. El itinerario se arma con las que sí respondieron.",
  lodging: "No pudimos cotizar el alojamiento de algunas fechas. El itinerario se arma con las que sí respondieron.",
};

const PRICE_STATES = new Set(["quota_historical", "partial_upstream"]);

export function degradedNotices(degraded: Record<string, string> | undefined): string[] {
  const entries = Object.entries(degraded ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const historical = entries.some(([, why]) => why === "quota_historical") ? [HISTORICAL_NOTICE] : [];
  const partial = entries.flatMap(([k, why]) => (why === "partial_upstream" && PARTIAL_NOTICE[k] ? [PARTIAL_NOTICE[k]] : []));
  const missing = entries.flatMap(([k, why]) => (!PRICE_STATES.has(why) && DEGRADED_NOTICE[k] ? [DEGRADED_NOTICE[k]] : []));
  return [...historical, ...partial, ...missing];
}

// Recortes que hizo el motor para que la búsqueda entre en el presupuesto de precios en vivo (cuota mensual).
const NARROWED_LABEL: Record<string, string> = {
  flex: "solo tu fecha de ida exacta (sin los días de flexibilidad)",
  overnight: "sin vuelos que salgan la noche anterior",
  rentals: "solo hoteles (sin alquileres temporarios)",
};

export function narrowedNotice(steps: string[] | undefined): string | null {
  const parts = (steps ?? []).flatMap((s) => (NARROWED_LABEL[s] ? [NARROWED_LABEL[s]] : []));
  if (parts.length === 0) return null;
  return `Para cuidar la cuota mensual de precios en vivo buscamos menos combinaciones: ${parts.join("; ")}. ` +
    "Tus condiciones se respetan igual; si repetís la búsqueda más tarde puede salir completa desde lo ya cotizado.";
}

// "Cotizado hace X": antigüedad de un precio real (fetched_at en UTC). null si no hay fecha o es inválida.
export function quotedAgo(fetchedAt: string | null | undefined, now: number = Date.now()): string | null {
  const t = fetchedAt ? Date.parse(fetchedAt) : NaN;
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 1) return "Cotizado recién";
  if (min < 60) return `Cotizado hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `Cotizado hace ${h} h`;
  return `Cotizado hace ${Math.floor(h / 24)} días`;
}

// Errores de una corrida que la persona puede resolver: mensaje claro en vez del código interno.
export const RUN_ERROR_MESSAGE: Record<string, string> = {
  quota_exhausted:
    "Se agotó la cuota mensual de precios en vivo y no tenemos precios guardados para estas fechas. " +
    "Probá con fechas más flexibles (o ya buscadas) o volvé a intentar más tarde.",
};

// Plan gratuito del motor: se duerme sin uso y la primera búsqueda lo despierta.
export const COLD_START_NOTICE =
  "Estamos encendiendo el servidor: como usamos un plan gratuito, se apaga cuando no hay uso y la primera búsqueda " +
  "puede tardar hasta un minuto. Las siguientes son mucho más rápidas.";
export const COLD_START_AFTER_MS = 4000;
