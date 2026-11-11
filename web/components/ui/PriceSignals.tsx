import ExternalIcon from "@/components/ui/ExternalIcon";
import type { CompareLink } from "@/lib/links";
import { TAG_LABEL, type PriceTag } from "@/lib/market";

// Piezas visuales compartidas por las tarjetas de vuelo y alojamiento (sin estado: se pueden memoizar sus padres).

const TAG_STYLE: Record<PriceTag, string> = {
  best: "bg-emerald-50 text-emerald-700",
  deal: "bg-rose-50 text-rose-700",
  scarce: "bg-amber-50 text-amber-800",
};

export function PriceTags({ tags }: { tags: PriceTag[] }) {
  return tags.map((t) => (
    <span key={t} data-testid={`tag-${t}`} className={`rounded-full px-3 py-1 text-xs font-semibold ${TAG_STYLE[t]}`}>
      {TAG_LABEL[t]}
    </span>
  ));
}

export function Stars({ stars, rating }: { stars: number | null | undefined; rating: number | null | undefined }) {
  if (!stars && rating == null) return null;
  return (
    <p className="mt-1 flex items-center gap-2 text-xs text-muted">
      {stars ? <span aria-label={`${stars} estrellas`} className="tracking-tight text-amber-500">{"★".repeat(stars)}</span> : null}
      {rating != null && (
        <span className="rounded-md bg-accent px-1.5 py-0.5 font-bold text-white" title="Puntuación de huéspedes (simulada en la demo)">
          {rating.toFixed(1)}
        </span>
      )}
    </p>
  );
}

/** Diferencia contra el promedio de las opciones de esta búsqueda. */
export function VsAverage({ diff }: { diff: number | undefined }) {
  if (diff === undefined || diff === 0) return null;
  const cheaper = diff < 0;
  return (
    <p className={`text-xs font-medium ${cheaper ? "text-emerald-700" : "text-muted"}`} data-testid="vs-average">
      {cheaper ? "↓" : "↑"} {Math.abs(diff)}% {cheaper ? "más barato" : "más caro"} que el promedio de esta búsqueda
    </p>
  );
}

/** Mini gráfico del precio más bajo por día consultado (datos reales de la corrida, no un historial de mercado). */
export function Sparkline({ points, current }: { points: { date: string; price: number }[]; current: string }) {
  if (points.length < 2) return null;
  const [w, h] = [96, 24];
  const prices = points.map((p) => p.price);
  const [lo, hi] = [Math.min(...prices), Math.max(...prices)];
  const x = (i: number) => (i / (points.length - 1)) * (w - 4) + 2;
  const y = (p: number) => (hi === lo ? h / 2 : h - 3 - ((p - lo) / (hi - lo)) * (h - 6));
  const i = points.findIndex((p) => p.date === current);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Precio más bajo por día consultado"
      className="text-accent">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points.map((p, j) => `${x(j)},${y(p.price)}`).join(" ")} />
      {i >= 0 && <circle cx={x(i)} cy={y(points[i].price)} r="2.5" fill="currentColor" />}
    </svg>
  );
}

export function CompareLinks({ links }: { links: CompareLink[] }) {
  if (links.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      Comparar en:
      {links.map((l) => (
        <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
          {l.label} <ExternalIcon />
        </a>
      ))}
    </p>
  );
}
