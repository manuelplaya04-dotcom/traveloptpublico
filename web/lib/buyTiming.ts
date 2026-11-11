// Contrato de la futura función "Momento óptimo de compra" (roadmap, Fase 6). Hoy no hay datos: la interfaz muestra
// el espacio reservado y nada inventado. Cuando exista un historial real (ingesta propia en Supabase a partir de las
// cotizaciones que el motor ya guarda), un proveedor llenará estos tipos sin cambiar la UI.

/** Un punto del historial de precio de una misma oferta (ruta + fecha, o propiedad + estadía). */
export interface PriceHistoryPoint {
  observedAt: string; // ISO 8601: cuándo se cotizó
  priceMinor: number; // centavos, misma moneda que el viaje
  source: string; // proveedor de la cotización (trazabilidad)
}

/** Serie histórica de una oferta comparable. */
export interface PriceHistory {
  offerKey: string; // p. ej. "flight:EZE-MCO:2027-07-08" o "lodging:H1:2027-07-08/2027-07-16"
  currency: "USD";
  points: PriceHistoryPoint[]; // ordenados por observedAt
}

export type BuyAdvice = "comprar_ahora" | "esperar" | "sin_datos_suficientes";

/** Recomendación derivada de la serie. `confidence` 0–1; por debajo de un umbral la UI muestra "sin datos". */
export interface BuyTimingInsight {
  offerKey: string;
  advice: BuyAdvice;
  confidence: number;
  vsMedianPct: number; // precio actual contra la mediana histórica (negativo = más barato)
  windowDays: number; // cuántos días de historial respaldan la recomendación
  generatedAt: string;
}

/** Proveedor a implementar (motor o API propia). Mientras no exista, `null`: la UI solo reserva el espacio. */
export type BuyTimingProvider = ((offerKeys: string[]) => Promise<BuyTimingInsight[]>) | null;
export const buyTimingProvider: BuyTimingProvider = null;
