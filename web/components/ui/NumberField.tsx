import { useId, type ReactNode } from "react";
import InfoTooltip from "@/components/ui/InfoTooltip";

// Campo numérico con etiqueta. `info`: ayuda opcional (ⓘ) FUERA del <label>, para que el nombre accesible del campo
// siga siendo solo la etiqueta.
export default function NumberField(props: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; hint?: string; info?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium text-ink">{props.label}</label>
        {props.info && <InfoTooltip>{props.info}</InfoTooltip>}
      </span>
      <input
        id={id}
        type="number"
        className="rounded-xl border border-line bg-white px-3 py-2.5 text-ink outline-none transition
          focus:border-accent focus:ring-4 focus:ring-accent-soft"
        value={Number.isFinite(props.value) ? props.value : ""}
        step={props.step ?? 1}
        min={props.min}
        max={props.max}
        onChange={(e) => props.onChange(e.target.valueAsNumber)}
      />
      {props.hint && <span className="text-xs text-muted">{props.hint}</span>}
    </div>
  );
}
