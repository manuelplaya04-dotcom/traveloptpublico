import { FlaskConical } from "lucide-react";
import { memo } from "react";
import CitySearch from "@/components/onboarding/CitySearch";
import CountControl from "@/components/ui/CountControl";
import NumberField from "@/components/ui/NumberField";
import { CITIES, cityByCode, MAX_CITIES } from "@/lib/cities";
import { assignedNights, NIGHTS_PER_CITY, TRIP_NIGHTS, type CityStop } from "@/lib/onboarding";

// Destinos en orden de visita (array dinámico, hasta MAX_CITIES) elegidos con el buscador, y reparto de las noches
// del viaje entre ellos con − / +.
export default memo(function StepDestinations({ stops, totalNights, onChange, onToggle, onTotalChange }: {
  stops: CityStop[];
  totalNights: number;
  onChange: (s: CityStop[]) => void;
  onToggle: (code: string) => void;
  onTotalChange: (n: number) => void;
}) {
  const move = (i: number, d: -1 | 1) => {
    const next = [...stops];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const update = (i: number, nights: number) => onChange(stops.map((s, j) => (j === i ? { ...s, nights } : s)));

  return (
    <div className="space-y-8">
      <div>
        <h3 className="flex flex-wrap items-center gap-2 font-display text-lg font-bold text-ink">
          ¿Adónde vas?
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">Beta</span>
        </h3>
        <p className="mt-1 text-sm text-muted">
          Buscá hasta {MAX_CITIES} ciudades y agregalas en el orden en que las querés visitar.
        </p>
        <BetaScope />
        <CitySearch describedBy="beta-scope" exclude={stops.map((s) => s.code)} disabled={stops.length >= MAX_CITIES} onPick={onToggle} />
      </div>

      {stops.length > 0 && (
        <>
          <ol className="space-y-3">
            {stops.map((s, i) => {
              const info = cityByCode(s.code);
              const name = info?.name ?? s.code;
              return (
                <li key={s.code} data-testid={`stop-${s.code}`}
                  className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line">
                  <span className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{name}</p>
                    <p className="text-xs text-muted">{info?.country} · {info?.airports.join(" · ")}</p>
                  </div>
                  <CountControl label={`Noches en ${name}`} value={s.nights} min={NIGHTS_PER_CITY.min}
                    max={NIGHTS_PER_CITY.max} onChange={(v) => update(i, v)} />
                  <div className="flex gap-1">
                    <IconButton label={`Subir ${s.code}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</IconButton>
                    <IconButton label={`Bajar ${s.code}`} disabled={i === stops.length - 1} onClick={() => move(i, 1)}>↓</IconButton>
                    <IconButton label={`Quitar ${s.code}`} onClick={() => onToggle(s.code)}>✕</IconButton>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="grid items-end gap-4 sm:grid-cols-2">
            <NumberField label="Duración total del viaje (noches)" value={totalNights} min={TRIP_NIGHTS.min}
              max={TRIP_NIGHTS.max} onChange={onTotalChange} />
            <Allocation assigned={assignedNights(stops)} total={totalNights} />
          </div>
        </>
      )}
    </div>
  );
});

// Alcance de la beta, visible antes de buscar (evita buscar destinos que todavía no existen). La lista sale del
// catálogo: si se suma una ciudad, el aviso se actualiza solo.
export const BETA_CITIES = new Intl.ListFormat("es", { type: "conjunction" }).format(CITIES.map((c) => c.name));
function BetaScope() {
  return (
    <p id="beta-scope" data-testid="beta-scope" className="mt-3 mb-4 rounded-xl bg-accent-soft/60 px-4 py-3 text-sm text-ink">
      <FlaskConical aria-hidden className="mr-1 inline size-4 align-text-bottom text-accent" />
      <b>Fase de prueba (Beta):</b> por ahora funciona solo para la <b>Costa Este de EE. UU.</b>: {BETA_CITIES}.
    </p>
  );
}

// Contador en vivo: verde cuando la suma coincide con la duración del viaje.
function Allocation({ assigned, total }: { assigned: number; total: number }) {
  const valid = Number.isFinite(assigned) && Number.isFinite(total);
  const ok = valid && assigned === total;
  return (
    <p role="status" data-testid="nights-allocation"
      className={`rounded-xl px-4 py-3 text-sm font-medium ${ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
      {valid ? `Noches asignadas: ${assigned} de ${total}` : "Completá las noches de cada ciudad y la duración total"}
      {ok ? " ✓" : ""}
    </p>
  );
}

function IconButton(props: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex size-8 items-center justify-center rounded-full text-muted transition hover:bg-white hover:text-ink disabled:opacity-30"
    >
      {props.children}
    </button>
  );
}
