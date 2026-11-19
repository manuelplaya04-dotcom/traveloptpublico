import { ChevronDown, FlaskConical } from "lucide-react";
import { memo, useSyncExternalStore } from "react";
import CitySearch from "@/components/onboarding/CitySearch";
import RouteOrderSwitch from "@/components/onboarding/RouteOrderSwitch";
import CountControl from "@/components/ui/CountControl";
import NumberField from "@/components/ui/NumberField";
import { activeCities, cityByCode, MAX_CITIES, scopeGroups } from "@/lib/cities";
import { assignedNights, NIGHTS_PER_CITY, TRIP_NIGHTS, type CityStop } from "@/lib/onboarding";

// Destinos en orden de visita (array dinámico, hasta MAX_CITIES) elegidos con el buscador, y reparto de las noches
// del viaje entre ellos con − / +. Con "Optimizar el orden" la lista deja de numerarse: el orden lo elige el motor.
export default memo(function StepDestinations({ stops, totalNights, optimizeOrder, onChange, onToggle, onTotalChange, onOptimizeOrder }: {
  stops: CityStop[];
  totalNights: number;
  optimizeOrder: boolean;
  onOptimizeOrder: (on: boolean) => void;
  onChange: (s: CityStop[]) => void;
  onToggle: (code: string) => void;
  onTotalChange: (n: number) => void;
}) {
  const move = (i: number, d: -1 | 1) => {
    const next = [...stops];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const free = optimizeOrder && stops.length > 1; // con una sola ciudad no hay orden que optimizar
  const update = (i: number, nights: number) => onChange(stops.map((s, j) => (j === i ? { ...s, nights } : s)));

  return (
    <div className="space-y-8">
      <div data-tour="destinations">
        <h3 className="flex flex-wrap items-center gap-2 font-display text-lg font-bold text-ink">
          ¿Adónde vas?
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">Beta</span>
        </h3>
        <p className="mt-1 text-sm text-muted">
          Buscá hasta {MAX_CITIES} ciudades y agregalas en el orden en que las querés visitar, o dejá que elijamos el más barato.
        </p>
        <BetaScope />
        <CitySearch describedBy="beta-scope" exclude={stops.map((s) => s.code)} disabled={stops.length >= MAX_CITIES} onPick={onToggle} />
      </div>

      {stops.length > 0 && (
        <>
          {stops.length > 1 && <RouteOrderSwitch on={optimizeOrder} cities={stops.length} onChange={onOptimizeOrder} />}
          <ol className="space-y-3" aria-label={free ? "Destinos (el orden lo elige el optimizador)" : "Destinos en orden de visita"}>
            {stops.map((s, i) => {
              const info = cityByCode(s.code);
              const name = info?.name ?? s.code;
              return (
                <li key={s.code} data-testid={`stop-${s.code}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface p-4 ring-1 ring-line">
                  {/* Celular: número, nombre y botones arriba; el contador abajo, alineado con el nombre. Desde sm, una fila. */}
                  <span aria-hidden={free} className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    free ? "bg-accent-soft text-accent" : "bg-accent text-white"}`}>{free ? "•" : i + 1}</span>
                  <div className="order-1 min-w-0 flex-1 sm:order-none">
                    <p className="font-semibold text-ink">{name}</p>
                    <p className="text-xs text-muted">{info?.country} · {info?.airports.join(" · ")}</p>
                  </div>
                  <div className="order-3 w-full pl-11 sm:order-none sm:w-auto sm:pl-0">
                    <CountControl label={`Noches en ${name}`} value={s.nights} min={NIGHTS_PER_CITY.min}
                      max={NIGHTS_PER_CITY.max} onChange={(v) => update(i, v)} unit={NIGHTS_UNIT} />
                  </div>
                  <div className="order-2 flex gap-1 sm:order-none">
                    {!free && <>
                      <IconButton label={`Subir ${s.code}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</IconButton>
                      <IconButton label={`Bajar ${s.code}`} disabled={i === stops.length - 1} onClick={() => move(i, 1)}>↓</IconButton>
                    </>}
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
// catálogo de la base: si se activa una ciudad, el aviso se actualiza solo.
const NIGHTS_UNIT = ["noche", "noches"] as const;

// Un renglón por región: se escanea de un vistazo en vez de leer un párrafo largo. Se puede minimizar (queda el título,
// que también es la descripción accesible del buscador) y la elección se recuerda en este navegador.
function BetaScope() {
  const [collapsed, setCollapsed] = useBetaCollapsed();
  return (
    <div id="beta-scope" data-testid="beta-scope" className="mt-3 mb-4 rounded-xl bg-accent-soft/60 px-4 py-3 text-sm text-ink">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">
          <FlaskConical aria-hidden className="mr-1 inline size-4 align-text-bottom text-accent" />
          Fase de prueba (Beta): por ahora, solo estas ciudades.
        </p>
        <button type="button" aria-expanded={!collapsed} aria-controls="beta-scope-list" data-testid="beta-scope-toggle"
          onClick={() => setCollapsed(!collapsed)}
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-accent-hover
            hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          {collapsed ? "Ver ciudades" : "Minimizar"}
          <ChevronDown aria-hidden className={`size-4 transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
      </div>
      <ul id="beta-scope-list" hidden={collapsed} className="mt-2 space-y-1.5">
        {scopeGroups(activeCities()).map((g) => (
          <li key={g.region} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
            <span><b>{g.title}:</b> {g.cities}.</span>
          </li>
        ))}
      </ul>
    </div>
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

// Aviso Beta minimizado o no, recordado en este navegador. useSyncExternalStore: en el servidor (y sin almacenamiento
// legible) siempre expandido, así la hidratación coincide y nunca se esconde el alcance por un error.
const BETA_KEY = "travelopt:beta-scope-collapsed:v1";
const betaListeners = new Set<() => void>();
let betaInMemory = false; // sin almacenamiento, vale para esta pestaña
function readBetaCollapsed(): boolean {
  try {
    return localStorage.getItem(BETA_KEY) === "1";
  } catch {
    return betaInMemory;
  }
}
function useBetaCollapsed(): [boolean, (v: boolean) => void] {
  const collapsed = useSyncExternalStore(
    (cb) => { betaListeners.add(cb); return () => { betaListeners.delete(cb); }; },
    readBetaCollapsed,
    () => false,
  );
  const set = (v: boolean) => {
    betaInMemory = v;
    try {
      if (v) localStorage.setItem(BETA_KEY, "1");
      else localStorage.removeItem(BETA_KEY);
    } catch {
      // sin almacenamiento: queda en memoria (betaInMemory) hasta recargar
    }
    for (const cb of betaListeners) cb();
  };
  return [collapsed, set];
}
