"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { resetSlot, select, totals, type Cart, type Pick, type Totals } from "@/lib/cart";

type CartApi = {
  cart: Cart;
  totals: Totals;
  budgetMinor: number;
  choose: (slot: string, pick: Pick) => void;
  reset: (slot?: string) => void; // sin slot: vuelve todo al óptimo
};

const Ctx = createContext<CartApi | null>(null);

// Opciones válidas por slot: id -> elección con su costo real (vuelos y alojamientos elegibles de la corrida).
export type Allowed = Record<string, Record<string, Pick>>;

// Las elecciones se recuerdan por corrida solo durante la sesión de la pestaña (sessionStorage, Ley 25.326: minimización),
// y SOLO los ids: el costo siempre sale de `allowed`.
// Lo que venga del storage no se cree (un valor editado a mano o de otra versión simplemente se ignora).
function load(key: string, allowed: Allowed): Record<string, Pick> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(saved).flatMap(([slot, v]) => {
      const id = typeof v === "string" ? v : (v as { id?: unknown } | null)?.id; // compatibilidad con el formato anterior
      const pick = typeof id === "string" ? allowed[slot]?.[id] : undefined;
      return pick ? [[slot, pick]] : [];
    }));
  } catch {
    return {};
  }
}

export function CartProvider({ base, optimal, allowed, budgetMinor, storageKey, children }: {
  base: Record<string, number>; optimal: Record<string, Pick>; allowed: Allowed; budgetMinor: number; storageKey: string;
  children: ReactNode;
}) {
  // El carrito se monta solo en el cliente (después de cargar las ofertas), así que se puede leer el storage al
  // inicializar. Leerlo en un efecto falla en desarrollo: StrictMode repite los efectos y el guardado pisaría la carga.
  const [cart, setCart] = useState<Cart>(() => ({ base, optimal, selected: load(storageKey, allowed) }));

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(Object.entries(cart.selected).map(([k, p]) => [k, p.id]))));
    } catch {
      // sin storage: la selección vive solo en esta pestaña
    }
  }, [storageKey, cart.selected]);

  // Acciones estables (useCallback): las tarjetas memoizadas que las reciben no se redibujan por cada cambio.
  const choose = useCallback((slot: string, pick: Pick) => setCart((c) => select(c, slot, pick)), []);
  const reset = useCallback((slot?: string) => setCart((c) => (slot ? resetSlot(c, slot) : { ...c, selected: {} })), []);
  // El subtotal se recalcula solo cuando cambia el carrito (useMemo), no en cada render de quien lo consume.
  const cartTotals = useMemo(() => totals(cart), [cart]);
  const api = useMemo<CartApi>(() => ({ cart, totals: cartTotals, budgetMinor, choose, reset }),
    [cart, cartTotals, budgetMinor, choose, reset]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart(): CartApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCart fuera de CartProvider");
  return v;
}
