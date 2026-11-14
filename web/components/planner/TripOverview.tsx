import CityOrder from "@/components/city/CityOrder";
import CurrencySwitch from "@/components/money/CurrencySwitch";
import ArsTotal from "@/components/planner/ArsTotal";
import RouteMap from "@/components/planner/RouteMap";
import { cityByCode, originFor } from "@/lib/cities";
import type { TripRequest } from "@/lib/contracts";
import { fmtDay } from "@/lib/format";
import { useMoney } from "@/components/money/MoneyProvider";
import type { ItineraryRow } from "@/lib/types";
import Alert from "@/components/ui/Alert";

// Cabecera del resultado: qué viaje es, el mapa del recorrido, el óptimo del motor y las otras combinaciones de
// fechas que calculó (se puede pasar a cualquiera; cada una tiene su propio carrito).
export default function TripOverview({ req, its, rank, onRank }: {
  req: TripRequest; its: ItineraryRow[]; rank: number; onRank: (r: number) => void;
}) {
  const money = useMoney(); // precios en la moneda elegida (USD o pesos)
  const it = its.find((x) => x.rank === rank) ?? its[0];
  const best = it.payload;
  const home = originFor(req.origin_airports);
  // Solo puntos con coordenadas reales: nada de (0, 0) inventado en el mapa de ruta si falta un dato.
  const homeStops = home ? [{ code: "HOME", name: home.name.split(" (")[0], lat: home.lat, lon: home.lon }] : [];
  const cityStops = best.order.flatMap((c) => {
    const rc = req.cities.find((x) => x.code === c);
    return rc ? [{ code: c, name: cityByCode(c)?.name ?? c, lat: rc.lat, lon: rc.lon }] : [];
  });
  const last = best.stays[best.stays.length - 1];
  const over = it.total_minor - req.budget_minor;

  return (
    <section aria-labelledby="trip-title" className="space-y-6">
      <div className="grid gap-8 rounded-3xl bg-surface p-6 sm:p-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:items-center">
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">Tu viaje óptimo</p>
            <h1 id="trip-title" className="mt-1 font-display text-3xl font-black tracking-tight text-ink sm:text-4xl">
              {cityStops.map((c) => c.name).join(" → ")}
            </h1>
            <p className="mt-2 text-muted">
              {req.pax} viajeros · {fmtDay(best.first_checkin)} → {fmtDay(last.check_out)} ·{" "}
              {best.stays.reduce((a, s) => a + s.nights, 0)} noches
            </p>
          </div>
          <div>
            <CurrencySwitch />
            <p className="mt-3 text-sm text-muted">Total calculado</p>
            <p className="font-display text-4xl font-black tracking-tight text-ink" data-testid="best-total">{money(it.total_minor)}</p>
            <p className="mt-1 text-xs text-muted">
              Por persona: <span data-testid="per-pax">{best.breakdown.per_pax_minor.map((x) => money(x)).join(" / ")}</span>
            </p>
            <ArsTotal totalMinor={it.total_minor} />
            {over > 0 && (
              <div className="mt-3">
                <Alert tone="warning" compact data-testid="over-budget">Supera el presupuesto por {money(over)}</Alert>
              </div>
            )}
          </div>
        </div>
        <div className="rounded-2xl bg-white p-2 shadow-sm print:hidden">
          <RouteMap stops={[...homeStops, ...cityStops, ...homeStops]} />
        </div>
      </div>

      {its.length > 1 && (
        <div className="print:hidden">
          <h2 className="font-display text-lg font-bold text-ink">Otras combinaciones de fechas</h2>
          <p className="text-sm text-muted">El motor ordenó todas las que cumplen tus condiciones. Podés ver cualquiera.</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {its.map((x) => {
              const active = x.rank === rank;
              return (
                <li key={x.rank}>
                  <button type="button" onClick={() => onRank(x.rank)} aria-pressed={active} data-testid={`alt-${x.rank}`}
                    className={`w-full rounded-2xl p-4 text-left lift transition-colors ${active ? "bg-accent/5 shadow-md ring-2 ring-accent" : "bg-white shadow-sm"}`}>
                    <span className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-muted">{fmtDay(x.payload.first_checkin)} · {x.payload.order.map((c) => `${cityByCode(c)?.name ?? c} ${x.payload.nights[c]}n`).join(" + ")}</span>
                      {x.rank === 1 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">Óptimo</span>}
                    </span>
                    <span className="mt-2 block font-display text-xl font-extrabold text-ink">{money(x.total_minor)}</span>
                    <span className="text-xs text-muted">{x.rank === 1 ? "La más barata" : `+${money(x.total_minor - its[0].total_minor)}`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <CityOrder key={best.order.join()} req={req} order={best.order} />
    </section>
  );
}
