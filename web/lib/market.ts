// Señales de precio para las tarjetas. Todas salen de datos de la propia búsqueda (las opciones que trajo el motor),
// nunca se inventan: "Mejor precio" es el mínimo del grupo, "En oferta" es ≥ 15% bajo su promedio y "Últimos
// lugares" sale de los asientos o unidades disponibles que informa el proveedor. No hay historial de mercado real
// todavía, así que la tendencia compara contra las demás fechas consultadas, no contra meses anteriores.
export type PriceTag = "best" | "deal" | "scarce";

export const TAG_LABEL: Record<PriceTag, string> = {
  best: "Mejor precio",
  deal: "En oferta",
  scarce: "Últimos lugares",
};

const DEAL_THRESHOLD = 0.15;

export type GroupStats = { min: number; avg: number };

export function groupStats(prices: number[]): GroupStats | undefined {
  const valid = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (valid.length === 0) return undefined;
  return { min: Math.min(...valid), avg: valid.reduce((a, b) => a + b, 0) / valid.length };
}

/** Diferencia contra el promedio del grupo, en % entero (negativo = más barato). */
export function vsAverage(price: number, stats: GroupStats | undefined): number | undefined {
  if (!stats || stats.avg <= 0) return undefined;
  return Math.round(((price - stats.avg) / stats.avg) * 100);
}

export function priceTags(price: number, stats: GroupStats | undefined, scarce: boolean, groupSize: number): PriceTag[] {
  const tags: PriceTag[] = [];
  if (stats && groupSize > 1 && price === stats.min) tags.push("best");
  const diff = vsAverage(price, stats);
  if (diff !== undefined && groupSize > 2 && diff <= -DEAL_THRESHOLD * 100) tags.push("deal");
  if (scarce) tags.push("scarce");
  return tags;
}

/** Pocos asientos: alcanzan justo para el grupo (o casi). */
export const fewSeats = (seats: number, pax: number) => seats <= pax + 2;

/** Precio mínimo por día de una ruta, para la mini tendencia (orden cronológico). */
export function dailyLows(points: { date: string; price: number }[]): { date: string; price: number }[] {
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(p.date, Math.min(byDay.get(p.date) ?? Infinity, p.price));
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, price]) => ({ date, price }));
}
