// Fechas de calendario (YYYY-MM-DD, sin hora ni zona) con objetos Date nativos en UTC: sumar días no se corre por
// cambios de horario de verano. Funciones puras, testeadas en test/dates.test.ts.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export const MAX_DAYS_AHEAD = 730; // se puede planificar hasta 2 años adelante

/** Fecha válida YYYY-MM-DD (rechaza "", años de más de 4 cifras y fechas inexistentes como 2027-02-30). */
export function isIsoDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`); // NaN para mes 13; 2027-02-30 se normaliza a marzo y no coincide
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Días entre dos fechas (b − a). */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Hoy en la zona horaria de la persona (no en UTC). */
export function todayIso(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
