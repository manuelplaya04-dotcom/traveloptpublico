import { z } from "zod";
import { fmtMinor } from "@/lib/money";

// Cotización del dólar en Argentina para MOSTRAR precios en pesos. El motor la trae de dolarapi.com y la cachea en la
// base (engine/app/services/fx.py); la web la pide a su propia ruta /api/fx. El total que concilia al centavo sigue
// siendo el del motor, en dólares: esto es solo presentación.
const rateSchema = z.object({
  cents_per_usd: z.number().int().positive().max(1e9), // centavos de peso por dólar (entero: sin coma flotante)
  updated_at: z.string(),
});
export const engineFxSchema = z.object({
  tarjeta: rateSchema,
  mep: rateSchema,
  source: z.literal("dolarapi.com"),
  fetched_at: z.string(),
  stale: z.boolean(),
});
export type FxRates = z.infer<typeof engineFxSchema>;

// Cómo se muestran los precios: en dólares (los del motor) o en pesos al dólar tarjeta o al MEP, las dos formas reales
// de pagar un viaje en dólares desde Argentina.
export type DisplayCurrency = "USD" | "tarjeta" | "mep";
export const DISPLAY_CURRENCIES: readonly DisplayCurrency[] = ["USD", "tarjeta", "mep"];

/** Centavos de dólar -> pesos enteros, con enteros (half-up, simétrico para los negativos). null si no es exacto. */
export function arsFromUsdMinor(usdMinor: number, centsPerUsd: number): number | null {
  const product = Math.abs(usdMinor) * centsPerUsd; // centavos de dólar × centavos de peso = pesos × 10.000
  if (!Number.isSafeInteger(usdMinor) || !Number.isSafeInteger(centsPerUsd) || !Number.isSafeInteger(product)) return null;
  const pesos = Math.floor((product + 5_000) / 10_000);
  return usdMinor < 0 ? -pesos : pesos;
}

// Estándar argentino: punto para miles y coma para decimales ("$ 1.234.567"). Sin centavos: es una referencia y un
// peso es menos que el error de la cotización del día. Un solo formateador por módulo (se llama por cada precio).
const ARS_FORMAT = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const fmtArs = (pesos: number) => ARS_FORMAT.format(pesos);
const RATE_FORMAT = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
export const fmtRate = (centsPerUsd: number) => RATE_FORMAT.format(centsPerUsd / 100); // "$ 1.475,50" (solo texto)

export type MoneyFormat = (usdMinor: number) => string;

/** Formateador de precios para el modo elegido. Sin cotización (o con un monto no convertible) muestra USD: un precio
 *  nunca queda en blanco ni se inventa una conversión. */
export function moneyFormat(mode: DisplayCurrency, rates: FxRates | null): MoneyFormat {
  if (mode === "USD" || !rates) return (m) => fmtMinor(m);
  const cents = rates[mode].cents_per_usd;
  return (m) => {
    const pesos = arsFromUsdMinor(m, cents);
    return pesos === null ? fmtMinor(m) : fmtArs(pesos);
  };
}
