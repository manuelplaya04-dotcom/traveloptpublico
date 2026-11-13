"use client";

import { useState } from "react";
import { useCart } from "@/components/cart/CartContext";
import { AlertIcon } from "@/components/ui/Alert";
import { fmtMinor } from "@/lib/money";

const ORDER = ["vuelos", "alojamiento", "actividades", "transporte"] as const;
const LABEL: Record<string, string> = { vuelos: "Vuelos", alojamiento: "Alojamiento", actividades: "Actividades", transporte: "Movilidad" };

// Subtotal dinámico flotante: siempre visible; en celular se expande para ver el desglose.
export default function SubtotalDock() {
  const { totals: t, budgetMinor, reset } = useCart();
  const [open, setOpen] = useState(false);
  const left = budgetMinor - t.totalMinor;

  return (
    <aside
      aria-label="Subtotal del viaje"
      data-tour="subtotal"
      // Capa superior: oscuro casi opaco y sombra amplia para separarlo del contenido. Sin backdrop-blur: fijo sobre la
      // página, obligaba a recalcular el desenfoque en cada cuadro de scroll (jank en celulares).
      className="fixed inset-x-3 bottom-3 z-40 rounded-3xl bg-ink/95 p-4 text-white shadow-xl ring-1 ring-white/10 lg:sticky lg:inset-auto lg:top-6 lg:p-6"
    >
      <button type="button" className="flex w-full items-center justify-between text-left lg:cursor-default"
        aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="text-sm text-white/70">Total del viaje</span>
        <span className="text-xs text-white/50 lg:hidden">{open ? "Ocultar ▾" : "Detalle ▴"}</span>
      </button>
      <p className="mt-1 font-display text-3xl font-black tracking-tight" data-testid="cart-total">{fmtMinor(t.totalMinor)}</p>
      <p className={`mt-1 text-sm font-medium ${t.deltaMinor > 0 ? "text-amber-300" : "text-emerald-300"}`} data-testid="cart-delta">
        {t.changed === 0 ? "✓ Elección óptima" : `${t.deltaMinor >= 0 ? "+" : ""}${fmtMinor(t.deltaMinor)} vs. óptimo`}
      </p>

      <div className={`${open ? "block" : "hidden"} lg:block`}>
        <dl className="mt-5 space-y-2 border-t border-white/15 pt-4 text-sm">
          {ORDER.map((c) => (
            <div key={c} className="flex justify-between">
              <dt className="text-white/70">{LABEL[c]}</dt>
              <dd className="tabular-nums">{fmtMinor(t.byCategory[c] ?? 0)}</dd>
            </div>
          ))}
        </dl>
        <p className={`mt-4 flex items-center gap-2 text-sm ${left >= 0 ? "text-white/70" : "rounded-xl bg-amber-400/15 px-3 py-2 font-semibold text-amber-300"}`}
          role={left < 0 ? "status" : undefined}>
          {left < 0 && <AlertIcon tone="warning" className="size-4" />}
          {left >= 0 ? `Te quedan ${fmtMinor(left)} del presupuesto` : `Excede el presupuesto por ${fmtMinor(-left)}`}
        </p>
        {t.changed > 0 && (
          <button type="button" onClick={() => reset()}
            className="mt-4 w-full rounded-full bg-white/10 py-2 text-sm font-semibold hover:bg-white/20">
            Volver al óptimo
          </button>
        )}
      </div>
    </aside>
  );
}
