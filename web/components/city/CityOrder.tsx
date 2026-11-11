"use client";

import { useRouter } from "next/navigation";
import { useState, type DragEvent } from "react";
import Button from "@/components/ui/Button";
import { cityByCode } from "@/lib/cities";
import type { TripRequest } from "@/lib/contracts";
import { createRun, runErrorMessage } from "@/lib/runs";

// Orden de las ciudades: arrastrar y soltar (o ← →). Al confirmar se lanza una corrida nueva con ese orden fijo:
// cambian los vuelos de interconexión, las fechas de cada estadía y todo lo demás se re-optimiza.
export default function CityOrder({ req }: { req: TripRequest }) {
  const router = useRouter();
  const original = req.cities.map((c) => c.code);
  const [order, setOrder] = useState(original);
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = order.join() !== original.join();

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setOrder(next);
  };
  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    if (dragging !== null) move(dragging, to);
    setDragging(null);
  };

  async function recalc() {
    setBusy(true);
    setError(null);
    try {
      const cities = order.map((code) => req.cities.find((c) => c.code === code)!);
      router.push(`/runs/${await createRun({ ...req, cities, fixed_order: true })}`);
    } catch (e) {
      setError(runErrorMessage(e));
      setBusy(false);
    }
  }

  if (original.length < 2) return null;
  return (
    <section aria-labelledby="order-title" className="rounded-3xl bg-surface p-6 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="order-title" className="font-display text-lg font-bold text-ink">Orden del viaje</h2>
          <p className="text-sm text-muted">Arrastrá las ciudades para cambiar el recorrido y recalculamos todo.</p>
        </div>
        {changed && (
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setOrder(original)}>Deshacer</Button>
            <Button disabled={busy} onClick={recalc}>{busy ? "Recalculando…" : "Recalcular con este orden"}</Button>
          </div>
        )}
      </div>
      <ol className="mt-5 flex flex-wrap items-center gap-2" aria-label="Ciudades en orden de visita">
        {order.map((code, i) => (
          <li key={code} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted" aria-hidden>→</span>}
            <span
              draggable
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, i)}
              onDragEnd={() => setDragging(null)}
              data-testid={`order-${code}`}
              className={`flex cursor-grab items-center gap-1 rounded-full bg-white py-1.5 pl-4 pr-1.5 text-sm font-semibold text-ink shadow-sm ring-1 active:cursor-grabbing ${
                dragging === i ? "opacity-50 ring-accent" : "ring-line"}`}
            >
              <span aria-hidden className="mr-1 text-muted">⠿</span>
              {i + 1}. {cityByCode(code)?.name ?? code}
              <button type="button" aria-label={`Mover ${cityByCode(code)?.name ?? code} antes`} disabled={i === 0}
                onClick={() => move(i, i - 1)} className="ml-2 flex size-7 items-center justify-center rounded-full text-muted hover:bg-surface disabled:opacity-30">←</button>
              <button type="button" aria-label={`Mover ${cityByCode(code)?.name ?? code} después`} disabled={i === order.length - 1}
                onClick={() => move(i, i + 1)} className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-surface disabled:opacity-30">→</button>
            </span>
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    </section>
  );
}
