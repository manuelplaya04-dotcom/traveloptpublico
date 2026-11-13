import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "@/components/landing/SiteFooter";
import CalendarButton from "@/components/planner/CalendarButton";
import { ensureCatalog } from "@/lib/catalog";
import { cityByCode } from "@/lib/cities";
import { engineFetch } from "@/lib/engine";
import { airlineName, fmtDay, fmtTime } from "@/lib/format";
import { fmtMinor } from "@/lib/money";
import type { ItineraryPayload } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Un link compartido no se indexa: es privado para quien lo recibe.
export const metadata: Metadata = { title: "Itinerario compartido · TravelOpt", robots: { index: false, follow: false } };

// El motor devuelve el payload de cada itinerario (rank, total_minor, vuelos, estadías…), ordenados por rank.
type Shared = { status: string; request: { pax: number }; itineraries: ItineraryPayload[] };

async function load(token: string): Promise<Shared | null> {
  try {
    const r = await engineFetch(`/v1/shares/${token}`);
    return r.ok ? ((await r.json()) as Shared) : null;
  } catch {
    return null;
  }
}

// Vista de solo lectura de un itinerario compartido (sin sesión, sin carrito, sin datos de quien lo compartió).
export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!UUID.test(token)) notFound();
  const data = await load(token);
  const p = data?.itineraries?.find((it) => it.rank === 1) ?? data?.itineraries?.[0];
  if (!data || !p?.stays?.length) notFound();
  await ensureCatalog();
  const name = (c: string) => cityByCode(c)?.name ?? c;
  return (
    <>
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10" data-testid="shared-itinerary">
        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">Itinerario compartido · solo lectura</p>
          <h1 className="font-display text-3xl font-black tracking-tight text-ink">{p.order.map(name).join(" → ")}</h1>
          <p className="text-muted">
            {data.request.pax} viajeros · {fmtDay(p.stays[0].check_in)} → {fmtDay(p.stays[p.stays.length - 1].check_out)}
          </p>
          <p className="font-display text-3xl font-black text-ink" data-testid="shared-total">{fmtMinor(p.total_minor)}</p>
          <div className="flex flex-wrap gap-3 print:hidden"><CalendarButton payload={p} /></div>
        </header>
        <section className="space-y-3">
          <h2 className="font-display text-xl font-bold text-ink">Vuelos</h2>
          <ul className="space-y-2">
            {p.flights.map(({ offer: f, leg }) => (
              <li key={leg} className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="font-semibold text-ink">{airlineName(f.carrier)} · {f.origin} → {f.destination}</p>
                <p className="text-sm text-muted">
                  {fmtDay(f.depart_at)} · {fmtTime(f.depart_at)} → {fmtTime(f.arrive_at)} · {f.stops === 0 ? "directo" : `${f.stops} escala(s)`}
                </p>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-3">
          <h2 className="font-display text-xl font-bold text-ink">Estadías</h2>
          <ul className="space-y-2">
            {p.stays.map((s) => (
              <li key={`${s.city}-${s.check_in}`} className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="font-semibold text-ink">{name(s.city)} · {s.nights} noches</p>
                <p className="text-sm text-muted">{s.lodging?.name ?? "Alojamiento propio"} · {fmtDay(s.check_in)} → {fmtDay(s.check_out)}</p>
                {s.activities.length > 0 && (
                  <p className="mt-1 text-sm text-muted">Actividades: {s.activities.map((a) => a.name).join(", ")}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
        <p className="text-sm text-muted">
          Precios calculados al momento de la búsqueda; confirmalos en cada proveedor.{" "}
          <Link href="/" className="font-semibold text-accent hover:underline">Armá tu propio viaje →</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
