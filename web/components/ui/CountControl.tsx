// Control numérico compacto con − y +: para cantidades chicas (noches por ciudad) es más rápido que tipear.
// El input sigue editable a mano; los botones se deshabilitan en los límites.
export default function CountControl({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  const ok = Number.isFinite(value);
  const btn = "flex size-9 items-center justify-center rounded-full text-lg font-semibold text-accent ring-1 ring-line transition hover:bg-accent-soft disabled:opacity-30";
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" className={btn} aria-label={`Restar 1 · ${label}`}
        disabled={ok && value <= min} onClick={() => onChange(ok ? value - 1 : min)}>−</button>
      <input type="number" aria-label={label} min={min} max={max} value={ok ? value : ""}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="w-14 rounded-lg border border-line bg-white py-1.5 text-center font-semibold text-ink outline-none focus:border-accent focus:ring-4 focus:ring-accent-soft" />
      <button type="button" className={btn} aria-label={`Sumar 1 · ${label}`}
        disabled={ok && value >= max} onClick={() => onChange(ok ? value + 1 : min)}>+</button>
    </div>
  );
}
