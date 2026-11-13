// Control numérico compacto con − y +: para cantidades chicas (noches por ciudad) es más rápido que tipear.
// El input sigue editable a mano; los botones se deshabilitan en los límites. `unit` ([singular, plural]) se muestra
// pegada al número ("4 noches") para que no quede un número suelto; el lector de pantalla ya la tiene en `label`.
export default function CountControl({ label, value, min, max, onChange, unit }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
  unit?: readonly [singular: string, plural: string];
}) {
  const ok = Number.isFinite(value);
  const btn = "flex size-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-accent ring-1 ring-line transition-colors hover:bg-accent-soft disabled:opacity-30";
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" className={btn} aria-label={`Restar 1 · ${label}`}
        disabled={ok && value <= min} onClick={() => onChange(ok ? value - 1 : min)}>−</button>
      <div className="flex items-baseline rounded-lg border border-line bg-white px-2 py-1.5 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent-soft">
        <input type="number" aria-label={label} min={min} max={max} value={ok ? value : ""}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className={`${unit ? "w-7 text-right" : "w-10 text-center"} bg-transparent font-semibold text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`} />
        {unit && <span aria-hidden className="ml-1 text-sm text-slate-600">{value === 1 ? unit[0] : unit[1]}</span>}
      </div>
      <button type="button" className={btn} aria-label={`Sumar 1 · ${label}`}
        disabled={ok && value >= max} onClick={() => onChange(ok ? value + 1 : min)}>+</button>
    </div>
  );
}
