// Carrito: parte del itinerario óptimo y reemplaza elecciones por "slot" (p. ej. "flight:1").
// Todo en centavos enteros: el total con las elecciones del optimizador es exactamente el del motor.
export type Category = "vuelos" | "alojamiento" | "actividades" | "transporte";
export type Pick = { id: string; label: string; category: Category; costMinor: number };
export type Cart = { base: Record<string, number>; optimal: Record<string, Pick>; selected: Record<string, Pick> };

export type Totals = { byCategory: Record<string, number>; totalMinor: number; deltaMinor: number; changed: number };

export function totals(cart: Cart): Totals {
  const byCategory = { ...cart.base };
  let deltaMinor = 0;
  let changed = 0;
  for (const [slot, opt] of Object.entries(cart.optimal)) {
    const sel = cart.selected[slot] ?? opt;
    const d = sel.costMinor - opt.costMinor;
    if (sel.id !== opt.id) changed++;
    byCategory[sel.category] = (byCategory[sel.category] ?? 0) + d;
    deltaMinor += d;
  }
  const totalMinor = Object.values(byCategory).reduce((a, b) => a + b, 0);
  return { byCategory, totalMinor, deltaMinor, changed };
}

export const select = (cart: Cart, slot: string, pick: Pick): Cart => ({ ...cart, selected: { ...cart.selected, [slot]: pick } });
export const resetSlot = (cart: Cart, slot: string): Cart => select(cart, slot, cart.optimal[slot]);
