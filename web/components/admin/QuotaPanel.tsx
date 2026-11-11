"use client";

import { useEffect, useState } from "react";

type Quota = {
  serpapi: { configured: boolean; searches_left: number | null; reserve: number; budget_per_run: number; exhausted: boolean };
  ticketmaster: { configured: boolean };
  alerts: Record<string, number>;
};

// Panel de administración (solo con NEXT_PUBLIC_ADMIN_MODE=true y, en el servidor, ADMIN_MODE=true): saldo de
// búsquedas de SerpApi, reserva, presupuesto por consulta y eventos operativos del motor. Si algo falla, no se muestra.
export default function QuotaPanel() {
  const [q, setQ] = useState<Quota | null>(null);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ADMIN_MODE !== "true") return;
    const ctl = new AbortController();
    fetch("/api/quota", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Quota | null) => { if (d?.serpapi) setQ(d); })
      .catch(() => undefined);
    return () => ctl.abort();
  }, []);
  if (!q) return null;
  const s = q.serpapi;
  const alerts = Object.entries(q.alerts);
  return (
    <aside aria-label="Panel de cuota (administración)" data-testid="quota-panel"
      className="mx-auto mt-8 max-w-xl rounded-2xl border border-dashed border-line bg-white p-4 text-sm print:hidden">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Admin · cuota de precios en vivo</p>
      {s.configured ? (
        <p className="mt-2 text-ink">
          SerpApi: <b data-testid="quota-left">{s.searches_left ?? "?"}</b> búsquedas restantes este mes · reserva {s.reserve} ·
          presupuesto {s.budget_per_run} por consulta {s.exhausted && <b className="text-red-700">· en modo histórico</b>}
        </p>
      ) : (
        <p className="mt-2 text-muted">SerpApi sin clave: datos de ejemplo.</p>
      )}
      <p className="text-muted">Ticketmaster: {q.ticketmaster.configured ? "activo" : "sin clave (módulo apagado)"}</p>
      {alerts.length > 0 && (
        <p className="mt-1 text-xs text-muted">Eventos desde el arranque: {alerts.map(([k, n]) => `${k} ×${n}`).join(" · ")}</p>
      )}
    </aside>
  );
}
