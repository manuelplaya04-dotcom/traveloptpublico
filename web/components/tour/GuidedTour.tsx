"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { hasSeen, markSeen, tourSelector, type Tour, type TourStep } from "@/lib/tour";

const START_DELAY_MS = 600; // deja que la pantalla termine de acomodarse antes de anclar el primer paso
const GAP = 10;
const EDGE = 8;
const MAX_W = 320;
const PAD = 6; // margen del resaltado alrededor del elemento

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Recorrido guiado liviano: una burbuja anclada a cada elemento `data-tour`, con resaltado, "Siguiente" y una X.
// Se muestra una sola vez por navegador (localStorage). Solo incluye los pasos cuyo elemento está en pantalla al
// empezar. Accesible: role="dialog" no modal, el foco va a la burbuja en cada paso, Esc la cierra (sin cerrar un
// <dialog> nativo que la contenga) y al terminar el foco vuelve adonde estaba. Sin dependencias.
export default function GuidedTour({ tour }: { tour: Tour }) {
  const [run, setRun] = useState<{ steps: TourStep[]; i: number } | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const store = storage();
    if (hasSeen(store, tour.id)) return;
    const timer = window.setTimeout(() => {
      const steps = tour.steps.filter((s) => document.querySelector(tourSelector(s.target)));
      if (steps.length === 0) return;
      markSeen(store, tour.id);
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setRun({ steps, i: 0 });
    }, START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [tour]);

  const close = useCallback(() => {
    setRun(null);
    setRect(null);
    returnFocus.current?.focus({ preventScroll: true });
  }, []);

  const step = run?.steps[run.i];
  useEffect(() => {
    if (!step) return;
    const find = () => document.querySelector<HTMLElement>(tourSelector(step.target));
    find()?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // Una medición por cuadro. Si el elemento ya no está (cambió la pantalla), el recorrido termina en vez de apuntar
    // a la nada.
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = find();
        if (el) setRect(el.getBoundingClientRect());
        else close();
      });
    };
    measure();
    // Esc cierra solo el recorrido: preventDefault evita que un <dialog> nativo lo tome como pedido de cierre
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  }, [step, close]);

  // El foco va a la burbuja en cada paso, recién cuando está ubicada (oculta no puede recibirlo).
  const placed = rect !== null;
  useEffect(() => {
    if (placed) box.current?.focus({ preventScroll: true });
  }, [step, placed]);

  if (!run || !step) return null;
  const last = run.i === run.steps.length - 1;
  const go = (i: number) => setRun({ ...run, i });

  return (
    <>
      {rect && (
        <div aria-hidden data-testid="tour-spotlight" style={spotlight(rect)}
          className="pointer-events-none fixed z-50 rounded-2xl ring-2 ring-accent shadow-[0_0_0_9999px_rgb(17_24_39/0.35)] transition-all duration-200" />
      )}
      <div ref={box} role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1}
        data-testid="guided-tour" style={rect ? bubble(rect) : { visibility: "hidden" }}
        className="fixed z-50 rounded-2xl bg-ink p-4 text-left text-white shadow-2xl outline-none print:hidden">
        <div className="flex items-start justify-between gap-3">
          <p id={titleId} className="font-display text-base font-bold">{step.title}</p>
          <button type="button" aria-label="Cerrar recorrido" onClick={close} data-testid="tour-close"
            className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <p id={bodyId} className="mt-1 text-sm leading-relaxed text-white/85">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs text-white/60">{run.i + 1} de {run.steps.length}</span>
          <div className="flex gap-2">
            {run.i > 0 && (
              <button type="button" onClick={() => go(run.i - 1)}
                className="rounded-full px-3 py-1.5 text-sm font-semibold text-white/80 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
                Anterior
              </button>
            )}
            <button type="button" onClick={() => (last ? close() : go(run.i + 1))} data-testid="tour-next"
              className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-ink hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              {last ? "Entendido" : "Siguiente"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function spotlight(r: DOMRect): CSSProperties {
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

// Debajo del elemento si entra; si no, arriba. Siempre dentro de la pantalla.
function bubble(r: DOMRect): CSSProperties {
  const width = Math.min(MAX_W, window.innerWidth - EDGE * 2);
  const left = Math.min(Math.max(r.left, EDGE), window.innerWidth - width - EDGE);
  const below = r.bottom + PAD + GAP + 180 < window.innerHeight;
  return below
    ? { left, width, top: Math.min(r.bottom + PAD + GAP, window.innerHeight - EDGE - 40) }
    : { left, width, bottom: Math.max(window.innerHeight - r.top + PAD + GAP, EDGE) };
}
