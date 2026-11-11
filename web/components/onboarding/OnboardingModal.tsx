"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import StepDates from "@/components/onboarding/StepDates";
import StepDestinations from "@/components/onboarding/StepDestinations";
import StepPreferences from "@/components/onboarding/StepPreferences";
import Button from "@/components/ui/Button";
import Stepper from "@/components/ui/Stepper";
import type { Constraints } from "@/lib/contracts";
import { buildTripRequest, initialState, toggleCity, validate, withCities, type CityStop, type OnboardingState, type StepErrors } from "@/lib/onboarding";
import { COLD_START_AFTER_MS, COLD_START_NOTICE } from "@/lib/format";
import { createRun, runErrorMessage } from "@/lib/runs";

const STEPS = ["Destinos", "Fechas y viajeros", "Preferencias"] as const;
const STEP_KEYS: (keyof StepErrors)[] = ["destinations", "dates", "preferences"];

// Pantalla 2: onboarding en un <dialog> nativo (foco atrapado, Esc cierra, el foco vuelve al CTA).
export default function OnboardingModal({ session, open, onClose }: { session: number; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  // Sin fecha al prerenderizar (Next no admite `new Date()` en el build): cada apertura llama a resetState, que pone
  // "hoy" ya en el navegador de la persona.
  const [s, setS] = useState<OnboardingState>(() => initialState(""));
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  // La navegación a /runs es una transición: React renderiza la página de resultados sin bloquear este formulario.
  const [navigating, startNavigation] = useTransition();

  // Vuelve TODO el formulario a su estado inicial: datos (hoy, sin destinos), paso, errores y estado de carga.
  function resetState() {
    setS(initialState());
    setStep(0);
    setShown([]);
    setBusy(false);
    setSlow(false);
  }
  // Cada apertura desde la landing es una sesión nueva. Se ajusta durante el render al cambiar la prop (patrón de
  // React para derivar estado de props), sin efectos ni remontar el <dialog>.
  const [seen, setSeen] = useState(session);
  if (session !== seen) {
    setSeen(session);
    resetState();
  }

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Despierta al motor (plan gratuito) mientras la persona completa el formulario; si falla, no importa.
  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    fetch("/api/warmup", { signal: ctl.signal }).catch(() => {});
    return () => ctl.abort();
  }, [open]);

  // Con cacheComponents, Next conserva la landing oculta (<Activity>) al navegar a /runs: sin esto el <dialog>
  // modal seguiría en la capa superior y dejaría inerte la página nueva.
  useEffect(() => {
    const d = ref.current;
    return () => d?.close();
  }, []);

  // Actualizadores estables (useCallback): los pasos los reciben como props y no cambian entre renders.
  const set = useCallback((patch: Partial<OnboardingState>) => setS((prev) => ({ ...prev, ...patch })), []);
  const setC = useCallback(<K extends keyof Constraints>(k: K, v: Constraints[K]) =>
    setS((prev) => ({ ...prev, constraints: { ...prev.constraints, [k]: v } })), []);
  const setCities = useCallback((cities: CityStop[]) => setS((prev) => ({ ...prev, ...withCities(prev, cities) })), []);
  const toggle = useCallback((code: string) => setS((prev) => ({ ...prev, ...toggleCity(prev, code) })), []);
  const setTotal = useCallback((totalNights: number) => set({ totalNights }), [set]);

  function next() {
    const errs = validate(s)[STEP_KEYS[step]];
    setShown(errs);
    if (errs.length === 0) setStep(step + 1);
  }

  // Pedido en curso: cerrar el formulario lo cancela, y una respuesta que llega tarde no navega ni pisa el estado
  // de una sesión nueva (carrera "Optimizar" → Esc → reabrir).
  const inflight = useRef<AbortController | null>(null);
  const handleClose = useCallback(() => {
    inflight.current?.abort();
    inflight.current = null;
    onClose();
  }, [onClose]);
  useEffect(() => () => inflight.current?.abort(), []);

  async function submit() {
    if (busy) return; // doble click: una sola corrida
    const all = validate(s);
    const firstBad = STEP_KEYS.findIndex((k) => all[k].length > 0);
    if (firstBad >= 0) {
      setStep(firstBad);
      setShown(all[STEP_KEYS[firstBad]]);
      return;
    }
    setBusy(true);
    setShown([]);
    const timer = setTimeout(() => setSlow(true), COLD_START_AFTER_MS);
    const ctl = new AbortController();
    inflight.current = ctl;
    try {
      const runId = await createRun(buildTripRequest(s), ctl.signal);
      if (ctl.signal.aborted) return;
      startNavigation(() => router.push(`/runs/${runId}`)); // `busy` sigue activo hasta que se navega
    } catch (e) {
      if (ctl.signal.aborted) return; // cancelado por la persona: no hay nada que mostrar
      setShown([runErrorMessage(e)]);
      setBusy(false);
    } finally {
      if (inflight.current === ctl) inflight.current = null;
      clearTimeout(timer);
      setSlow(false);
    }
  }

  const last = step === STEPS.length - 1;
  return (
    <dialog
      ref={ref}
      aria-labelledby="onboarding-title"
      onClose={handleClose}
      onClick={(e) => e.target === ref.current && !busy && handleClose()} // click en el fondo
      className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-3xl bg-white p-0 text-left text-ink shadow-2xl"
    >
      {/* Alto fijo en pantallas medianas: los pasos no cambian el tamaño del modal (sin saltos). */}
      <div className="flex max-h-[90dvh] flex-col sm:h-[min(90dvh,46rem)]">
        <header className="space-y-6 border-b border-line px-6 pb-6 pt-6 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="onboarding-title" className="font-display text-2xl font-black tracking-tight">Armemos tu viaje</h2>
              <p className="mt-1 text-sm text-muted">Paso {step + 1} de {STEPS.length}</p>
            </div>
            <button type="button" aria-label="Cerrar" disabled={busy} onClick={handleClose}
              className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink">
              ✕
            </button>
          </div>
          <Stepper steps={[...STEPS]} current={step} />
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-8 sm:px-8">
          {step === 0 && (
            <StepDestinations stops={s.cities} totalNights={s.totalNights}
              onChange={setCities} onToggle={toggle} onTotalChange={setTotal} />
          )}
          {step === 1 && <StepDates s={s} set={set} />}
          {step === 2 && <StepPreferences c={s.constraints} set={setC} />}

          {busy && slow && (
            <p role="status" data-testid="cold-start-notice" className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
              {COLD_START_NOTICE}
            </p>
          )}
          {shown.length > 0 && (
            <ul role="alert" className="mt-6 space-y-1 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
              {shown.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-6 py-5 sm:px-8">
          {step > 0 ? (
            <Button variant="ghost" disabled={busy} onClick={() => { setShown([]); setStep(step - 1); }}>← Atrás</Button>
          ) : <span />}
          {last ? (
            <Button size="lg" disabled={busy || navigating} aria-busy={busy || navigating} onClick={submit}>
              {(busy || navigating) && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {busy || navigating ? "Optimizando…" : "Optimizar itinerario"}
            </Button>
          ) : (
            <Button size="lg" onClick={next}>Siguiente →</Button>
          )}
        </footer>
      </div>
    </dialog>
  );
}
