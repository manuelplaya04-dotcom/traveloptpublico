import { ChefHat, CloudRain, Sun } from "lucide-react";
import InfoTooltip from "@/components/ui/InfoTooltip";
import NumberField from "@/components/ui/NumberField";
import type { Constraints, Services } from "@/lib/contracts";

// Restricciones duras: el motor descarta lo que no cumple y lo explica en el embudo.
// Solo las condiciones de los módulos que se cotizan: sin vuelos no hay escalas que limitar.
export default function StepPreferences({ c, services, set }: {
  c: Constraints; services: Services; set: <K extends keyof Constraints>(k: K, v: Constraints[K]) => void;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="font-display text-lg font-bold text-ink">Lo que no negociás</h3>
        <p className="mt-1 text-sm text-muted">
          Son condiciones obligatorias: descartamos toda opción que no las cumpla y te decimos cuántas quedaron afuera.
        </p>
      </div>
      {(services.lodging || services.flights) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {services.lodging && (
            <NumberField label="Baños mínimos" value={c.min_bathrooms} min={0} max={10} onChange={(v) => set("min_bathrooms", v)}
              info={HELP.bathrooms} />
          )}
          {services.flights && (
            <>
              <NumberField label="Escalas máximas" value={c.max_stops} min={0} max={3} onChange={(v) => set("max_stops", v)}
                info={HELP.stops} />
              <NumberField label="Valijas despachadas por persona" value={c.checked_bags_per_pax} min={0} max={3}
                onChange={(v) => set("checked_bags_per_pax", v)} info={HELP.bags} />
            </>
          )}
        </div>
      )}
      {services.lodging && (
        <div className="flex items-start gap-1 rounded-2xl bg-surface p-5 ring-1 ring-line">
          <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
            <input type="checkbox" checked={c.require_kitchen ?? false} onChange={(e) => set("require_kitchen", e.target.checked)}
              data-testid="require-kitchen" className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--color-accent)]" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink"><ChefHat aria-hidden className="mr-1 inline size-4 align-text-bottom text-accent" />Exigir alojamiento con cocina</span>
              <span className="mt-0.5 block text-xs text-muted">Cocina o kitchenette, según lo que informa cada alojamiento.</span>
            </span>
          </label>
          <InfoTooltip>{HELP.kitchen}</InfoTooltip>
        </div>
      )}
      {services.activities && <RainSlider value={c.max_heavy_rain_prob} onChange={(v) => set("max_heavy_rain_prob", v)} />}
    </div>
  );
}

// Microcopy de ayuda: describe exactamente lo que hace el motor (engine/app/optimizer/filters.py y providers/hotels.py).
export const HELP = {
  bathrooms: "Mínimo de baños para todo el grupo, sumando todas las habitaciones o unidades. En hoteles contamos 1 baño privado por habitación (2 huéspedes cada una); en alquileres, los que informa el anuncio, o 1 si no lo dice.",
  stops: "Máximo de escalas en cada tramo de vuelo (ida, vuelta y entre ciudades), no en el total del viaje. 0 = solo vuelos directos en todos los tramos.",
  bags: "Por persona y por tramo. Si la tarifa no las incluye, sumamos al total lo que cobra la aerolínea.",
  kitchen: "Solo quedan los alojamientos que informan cocina o kitchenette. Casi ningún hotel lo informa, así que en la práctica quedan alquileres temporarios (en Nueva York solo se permiten desde 30 noches). Si no hay ninguno, te lo decimos en vez de suponer que tienen.",
};

// Tolerancia a la lluvia como deslizador (0 a 1 en pasos de 5%): más claro que tipear una probabilidad.
function RainSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const pct = Math.round(value * 100);
  return (
    <label className="block rounded-2xl bg-surface p-5 ring-1 ring-line">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink">Lluvia máxima para actividades al aire libre</span>
        <span className="font-display text-lg font-extrabold text-accent" data-testid="rain-value">{pct}%</span>
      </span>
      <input type="range" min={0} max={1} step={0.05} value={value} aria-valuetext={`${pct}% de probabilidad de lluvia fuerte`}
        onChange={(e) => onChange(e.target.valueAsNumber)} className="mt-4 w-full accent-accent" />
      <span className="mt-1 flex justify-between text-xs text-muted">
        <span><Sun aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />0 · sin riesgo</span>
        <span><CloudRain aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />1 · no importa la lluvia</span>
      </span>
      <span className="mt-2 block text-xs text-muted">
        Los días con más probabilidad de lluvia fuerte que esto no agendamos actividades al aire libre.
      </span>
    </label>
  );
}
