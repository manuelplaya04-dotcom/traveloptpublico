import { z } from "zod";

// Cotizaciones del dólar en Argentina (dolarapi.com, sin clave). Solo para mostrar el viaje en pesos: el total que
// concilia al centavo sigue siendo el del motor, en dólares.
const rowSchema = z.object({
  casa: z.string(),
  venta: z.number().positive().finite(),
  fechaActualizacion: z.string(),
});
export const dolarApiSchema = z.array(rowSchema);

export type Rate = { venta: number; updatedAt: string };
export type FxRates = { tarjeta: Rate; mep: Rate; source: "dolarapi.com" };

// Las dos formas reales de pagar un viaje en dólares desde Argentina: tarjeta (dólar tarjeta) o dólares comprados por
// MEP ("bolsa" en dolarapi). Si falta alguna, no hay cotización (la sección se oculta, nada se inventa).
export function pickRates(rows: z.infer<typeof dolarApiSchema>): FxRates | null {
  const by = new Map(rows.map((r) => [r.casa, r]));
  const t = by.get("tarjeta");
  const m = by.get("bolsa");
  if (!t || !m) return null;
  return {
    tarjeta: { venta: t.venta, updatedAt: t.fechaActualizacion },
    mep: { venta: m.venta, updatedAt: m.fechaActualizacion },
    source: "dolarapi.com",
  };
}

// Centavos de dólar -> pesos enteros (redondeo al peso más cercano; es una referencia, no un cobro).
export const arsFromUsdMinor = (usdMinor: number, venta: number) => Math.round((usdMinor * venta) / 100);

export const fmtArs = (pesos: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(pesos);
