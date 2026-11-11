// Mismo formato que engine/app/domain/money.py::fmt. Opera sobre enteros: sin errores de coma flotante.
export function fmtMinor(minor: number, currency = "USD"): string {
  if (!Number.isSafeInteger(minor)) throw new Error(`monto no entero: ${minor}`);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const units = Math.trunc(abs / 100).toLocaleString("en-US");
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}${currency} ${units}.${cents}`;
}

export function toMinor(units: number): number {
  return Math.round(units * 100);
}

export function minorToUnits(minor: number): number {
  return minor / 100;
}
