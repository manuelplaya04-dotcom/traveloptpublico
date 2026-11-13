import NumberField from "@/components/ui/NumberField";
import { cityByCode, ORIGINS } from "@/lib/cities";
import { addDays, MAX_DAYS_AHEAD, todayIso } from "@/lib/dates";
import { fmtDay } from "@/lib/format";
import {
  FLEX_DAYS, PAX, returnBounds, returnDate, withReturnDate, type OnboardingState,
} from "@/lib/onboarding";

const input = "rounded-xl border border-line bg-white px-3 py-2.5 text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft";

// Ida, vuelta y duración vinculadas: la vuelta es siempre ida + noches. Elegir la vuelta recalcula las noches;
// el calendario de vuelta solo ofrece fechas entre 1 y 60 noches después de la ida, y el de ida no ofrece el pasado.
// Solo se renderiza en el cliente (paso 2 del modal), así "hoy" es la fecha de la persona y no la del build.
export default function StepDates({ s, set }: { s: OnboardingState; set: (patch: Partial<OnboardingState>) => void }) {
  const today = todayIso();
  const back = returnDate(s);
  const bounds = returnBounds(s.departDate);
  const split = s.cities.map((c) => `${cityByCode(c.code)?.name ?? c.code} ${c.nights}`).join(" + ");

  return (
    <div className="space-y-8">
      <div>
        <h3 className="font-display text-lg font-bold text-ink">¿Cuándo y cuántos?</h3>
        <p className="mt-1 text-sm text-muted">La vuelta se calcula sola con la duración del viaje, o elegila y ajustamos las noches.</p>
      </div>

      {/* Sin vuelos (ya tiene pasajes) no hay origen que elegir: el viaje arranca en el primer destino. */}
      {s.services.flights && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Salís desde</span>
          <select className={input} value={s.origin} onChange={(e) => set({ origin: e.target.value })}>
            {ORIGINS.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">{s.services.flights ? "Fecha de ida (primera noche)" : "Primera noche del viaje"}</span>
          <input type="date" className={input} value={s.departDate} min={today} max={addDays(today, MAX_DAYS_AHEAD)}
            onChange={(e) => set({ departDate: e.target.value })} />
          {s.services.flights && <span className="text-xs text-muted">Si conviene, el vuelo sale la noche anterior.</span>}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">{s.services.flights ? "Fecha de vuelta" : "Último día (check-out)"}</span>
          <input type="date" className={input} value={back ?? ""} min={bounds?.min} max={bounds?.max}
            disabled={!bounds} onChange={(e) => set(withReturnDate(s, e.target.value))} />
          <span className="text-xs text-muted" data-testid="trip-length">
            {back ? `${s.totalNights} noches${split ? ` · ${split}` : ""}` : "Elegí primero la fecha de ida"}
          </span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField label="Flexibilidad de ida (días)" value={s.flexDays} min={FLEX_DAYS.min} max={FLEX_DAYS.max}
          hint={back && s.flexDays > 0 ? `Probamos salir hasta el ${fmtDay(addDays(s.departDate, s.flexDays))}` : "0 = fecha exacta"}
          onChange={(v) => set({ flexDays: v })} />
        <NumberField label="Viajeros" value={s.pax} min={PAX.min} max={PAX.max} onChange={(v) => set({ pax: v })} />
        <NumberField label="Presupuesto total (USD)" value={s.budget} min={0} step={100} onChange={(v) => set({ budget: v })} />
      </div>
    </div>
  );
}
