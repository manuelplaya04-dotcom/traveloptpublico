import { BedDouble, Plane, Ticket, type LucideIcon } from "lucide-react";
import { NO_SERVICE_SELECTED, type Services } from "@/lib/contracts";

const ITEMS: { key: keyof Services; label: string; hint: string; Icon: LucideIcon }[] = [
  { key: "flights", label: "Vuelos", hint: "Ida, vuelta y entre ciudades", Icon: Plane },
  { key: "lodging", label: "Alojamiento", hint: "Hoteles y alquileres", Icon: BedDouble },
  { key: "activities", label: "Actividades", hint: "Imperdibles por día", Icon: Ticket },
];

// Qué cotiza el optimizador. Cada tarjeta es un switch (role="switch": Espacio o Enter lo cambian, el lector de
// pantalla anuncia "activado/desactivado"). Apagar uno = "ya lo tengo": no se busca ni se suma al total.
export default function ServiceToggles({ value, onChange }: { value: Services; onChange: (next: Services) => void }) {
  const none = !(value.flights || value.lodging || value.activities);
  return (
    <fieldset data-tour="services" className="space-y-3">
      <legend className="text-sm font-medium text-ink">¿Qué querés que cotice?</legend>
      <p className="text-xs text-muted">Desactivá lo que ya tenés resuelto: lo dejamos fuera de la búsqueda y del total.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {ITEMS.map(({ key, label, hint, Icon }) => {
          const on = value[key];
          return (
            <button key={key} type="button" role="switch" aria-checked={on} data-testid={`service-${key}`}
              onClick={() => onChange({ ...value, [key]: !on })}
              className={`flex items-center gap-3 rounded-2xl p-3 text-left ring-1 transition focus-visible:outline-2
                focus-visible:outline-offset-2 focus-visible:outline-accent ${
                on ? "bg-accent-soft ring-accent" : "bg-white ring-line hover:ring-ink/30"}`}>
              <Icon aria-hidden className={`size-5 shrink-0 ${on ? "text-accent" : "text-muted"}`} />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-semibold ${on ? "text-ink" : "text-muted"}`}>{label}</span>
                <span className="block truncate text-xs text-slate-600">{on ? hint : "Ya lo tengo"}</span>
              </span>
              {/* Pista del switch: el estado ya lo da aria-checked */}
              <span aria-hidden className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}>
                <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
              </span>
            </button>
          );
        })}
      </div>
      {none && <p role="alert" className="text-sm font-medium text-red-700">{NO_SERVICE_SELECTED}</p>}
    </fieldset>
  );
}
