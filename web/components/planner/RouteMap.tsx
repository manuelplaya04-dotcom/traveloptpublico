// Mapa esquemático del recorrido (SVG propio, sin proveedor de mapas): proyección equirectangular de las
// coordenadas reales, arcos entre paradas en orden y etiquetas. Escala al ancho disponible.
export type Stop = { code: string; name: string; lat: number; lon: number };

const W = 640, H = 280, PAD = 48;

export default function RouteMap({ stops }: { stops: Stop[] }) {
  if (stops.length === 0) return null;
  // Ida y vuelta: el último punto repite el primero (casa); se dibuja una sola vez.
  const unique = stops.filter((s, i) => stops.findIndex((x) => x.code === s.code) === i);
  const k = Math.cos((unique.reduce((a, s) => a + s.lat, 0) / unique.length) * Math.PI / 180);
  const xs = unique.map((s) => s.lon * k), ys = unique.map((s) => -s.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((W - 2 * PAD) / Math.max(x1 - x0, 1e-6), (H - 2 * PAD) / Math.max(y1 - y0, 1e-6));
  const ox = (W - (x1 - x0) * scale) / 2, oy = (H - (y1 - y0) * scale) / 2;
  const pt = (s: Stop) => ({ x: ox + (s.lon * k - x0) * scale, y: oy + (-s.lat - y0) * scale });

  const arcs = stops.slice(1).map((s, i) => {
    const a = pt(stops[i]), b = pt(s);
    const [mx, my, dx, dy] = [(a.x + b.x) / 2, (a.y + b.y) / 2, b.x - a.x, b.y - a.y];
    const len = Math.hypot(dx, dy) || 1, bend = Math.min(60, len * 0.25) * (i % 2 ? -1 : 1);
    return `M${a.x},${a.y} Q${mx - (dy / len) * bend},${my + (dx / len) * bend} ${b.x},${b.y}`;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
      aria-label={`Recorrido: ${stops.map((s) => s.name).join(" → ")}`}>
      {arcs.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} strokeDasharray="6 6" strokeLinecap="round" />
      ))}
      {unique.map((s, i) => {
        const p = pt(s);
        const home = i === 0;
        return (
          <g key={s.code}>
            <circle cx={p.x} cy={p.y} r={home ? 7 : 9} fill={home ? "var(--color-ink)" : "var(--color-accent)"} stroke="white" strokeWidth={3} />
            {/* Casa debajo; destinos alternando derecha/izquierda para que no se pisen ciudades cercanas. */}
            <text x={home ? p.x : p.x + (i % 2 ? -16 : 16)} y={home ? p.y + 24 : p.y + 4}
              textAnchor={home ? "middle" : i % 2 ? "end" : "start"} className="fill-ink text-[13px] font-semibold">{s.name}</text>
          </g>
        );
      })}
    </svg>
  );
}
