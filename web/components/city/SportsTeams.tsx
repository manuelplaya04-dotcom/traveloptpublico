import { memo } from "react";
import { Trophy } from "lucide-react";
import ExternalIcon from "@/components/ui/ExternalIcon";
import { safeHref } from "@/lib/links";
import { TEAMS_BY_CITY, ticketsUrl } from "@/lib/sports";
import MapButton from "@/components/ui/MapButton";
import { venueFocus } from "@/lib/mapTargets";

// Deportes en la ciudad: equipos, liga y estadio (datos reales y estáticos). Sin fechas ni precios: el calendario y las
// entradas se consultan en la fuente oficial.
export default memo(function SportsTeams({ city, cityName }: { city: string; cityName: string }) {
  const teams = TEAMS_BY_CITY[city];
  if (!teams?.length) return null;
  return (
    <section aria-labelledby={`sports-${city}`} className="space-y-4 print:hidden" data-testid="sports">
      <div>
        <h4 id={`sports-${city}`} className="font-display text-lg font-bold text-ink"><Trophy aria-hidden className="mr-1.5 inline size-5 align-text-bottom text-accent" />Deportes en {cityName}</h4>
        <p className="text-sm text-muted">Equipos locales. Revisá en la fuente oficial si juegan de local durante tu estadía.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {teams.map((t) => {
          const href = safeHref(ticketsUrl(t));
          return (
            <li key={t.name} className="flex flex-col rounded-2xl bg-white p-4 shadow-sm lift transition-colors duration-300" data-testid="sports-team">
              <span className="w-fit rounded-full bg-surface px-2.5 py-0.5 text-xs font-bold text-muted">{t.league}</span>
              <p className="mt-2 font-semibold text-ink">{t.name}</p>
              <p className="text-xs text-muted">{t.venue}</p>
              <MapButton focus={venueFocus(city, t.venue)} className="mt-2" />
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer"
                  className="mt-3 text-sm font-semibold text-accent hover:underline">Ver calendario oficial y entradas <ExternalIcon /></a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
});
