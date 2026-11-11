"use client";

import Link from "next/link";
import Funnel from "@/components/Funnel";
import FunnelExplanation from "@/components/FunnelExplanation";
import SiteFooter from "@/components/landing/SiteFooter";
import TripPlanner from "@/components/planner/TripPlanner";
import TripPreview from "@/components/planner/TripPreview";
import { TERMINAL, useRun } from "@/hooks/useRun";
import { degradedNotices, narrowedNotice, RUN_ERROR_MESSAGE } from "@/lib/format";
import { suggestions } from "@/lib/suggestions";
import RetryAlert from "@/components/ui/RetryAlert";
import Alert from "@/components/ui/Alert";
import QuotaPanel from "@/components/admin/QuotaPanel";

const STEPS = ["queued", "extracting", "optimizing", "done"] as const;
const STEP_LABEL = { queued: "En cola", extracting: "Buscando ofertas", optimizing: "Optimizando", done: "Listo" };

export default function RunView({ runId }: { runId: string }) {
  const { run, missing, its, itsFailed, retry } = useRun(runId);

  if (!run) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-16 text-muted" data-testid="run-missing" aria-busy={!missing}>
        {missing ? (
          <span>Corrida no encontrada o sin permiso para verla.{" "}
            <Link href="/" className="font-semibold text-accent hover:underline">Armar un viaje nuevo →</Link></span>
        ) : (
          // Skeleton con la forma del resultado: la página no salta cuando llegan los datos.
          <div className="animate-pulse space-y-6" role="status" aria-label="Cargando corrida">
            <div className="h-10 w-2/3 rounded-2xl bg-surface" />
            <div className="h-40 rounded-3xl bg-surface" />
            <div className="grid gap-5 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-48 rounded-3xl bg-surface" />)}</div>
          </div>
        )}
      </main>
    );
  }
  const s = run.summary;
  const running = !TERMINAL.has(run.status);
  const tips = run.status === "infeasible" ? suggestions(s.diagnostics) : [];

  return (
    <>
    <header className="border-b border-line print:hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Link href="/" className="font-display text-xl font-black tracking-tight text-ink">
          Travel<span className="text-accent">Opt</span>
        </Link>
        <Link href="/" className="rounded-full px-4 py-2 text-sm font-semibold text-accent ring-1 ring-line hover:bg-surface">
          Nuevo viaje
        </Link>
      </div>
    </header>
    {/* min-h-dvh: el pie queda fuera de la vista mientras carga, así el contenido que llega no lo empuja (CLS). */}
    <main className="mx-auto min-h-dvh max-w-7xl space-y-12 px-6 pb-72 pt-10 lg:pb-24">
      <p data-testid="run-status" className="sr-only">{run.status}</p>
      {running && (
        <section aria-live="polite" className="mx-auto max-w-2xl rounded-3xl bg-surface p-8 text-center">
          <p className="font-display text-2xl font-black text-ink">Armando tu viaje…</p>
          <p className="mt-2 text-sm text-muted">Comparamos todas las combinaciones. Puede tardar hasta un minuto si el motor estaba en reposo.</p>
          <ol className="mt-6 flex flex-wrap justify-center gap-2 text-sm" aria-label="Progreso">
            {STEPS.map((st) => (
              <li key={st} className={`rounded-full px-3 py-1 font-medium ${run.timings[st] ? "bg-accent text-white" : "bg-white text-muted"}`}>
                {STEP_LABEL[st]}
              </li>
            ))}
          </ol>
          <TripPreview runId={runId} />
        </section>
      )}

      {run.status === "failed" && (
        <Alert tone="danger" data-testid="run-error">
          {RUN_ERROR_MESSAGE[run.error?.code ?? ""] ?? `Falló en ${run.error?.node ?? "?"}: ${run.error?.code}`}
        </Alert>
      )}
      {run.status === "infeasible" && (
        <Alert tone="warning">
          <p>Ninguna combinación cumple tus condiciones. Abajo ves qué opciones quedaron afuera y por qué.</p>
          <FunnelExplanation runId={runId} />
          {tips.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 font-normal" data-testid="suggestions">
              {tips.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
          <Link href="/" className="mt-2 inline-block font-semibold text-accent hover:underline">Cambiar el viaje →</Link>
        </Alert>
      )}

      {narrowedNotice(s.quota_narrowed) && (
        <Alert tone="warning" role="status" compact data-testid="narrowed-notice">{narrowedNotice(s.quota_narrowed)}</Alert>
      )}
      {degradedNotices(s.degraded).map((n) => (
        <Alert key={n} tone="warning" role="status" compact data-testid="degraded-notice">{n}</Alert>
      ))}

      {itsFailed && <RetryAlert message="La búsqueda terminó, pero no pudimos cargar los resultados." onRetry={retry} />}

      {its.length > 0 ? (
        <TripPlanner key={runId} runId={runId} its={its}>
          {s.diagnostics && <Funnel diagnostics={s.diagnostics} />}
        </TripPlanner>
      ) : (
        s.diagnostics && <Funnel diagnostics={s.diagnostics} defaultOpen={run.status === "infeasible"} />
      )}
      <QuotaPanel />
    </main>
    <SiteFooter />
    </>
  );
}
