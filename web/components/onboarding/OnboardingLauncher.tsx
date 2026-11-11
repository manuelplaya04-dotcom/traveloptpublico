"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import OnboardingModal from "@/components/onboarding/OnboardingModal";
import Button from "@/components/ui/Button";

// true solo en el cliente ya hidratado (en el servidor y durante la hidratación vale false): sin efectos ni mismatch.
const noop = () => () => {};
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

// CTA central de la landing: abre el onboarding sin recargar la página.
// Cada apertura es una sesión nueva (`session`): el formulario vuelve a su estado inicial (resetState).
// Hace falta porque Next conserva la landing oculta (<Activity>) al ir a /runs y, al volver con "Nuevo viaje",
// el formulario seguía en el paso 3 con "Optimizando…".
export default function OnboardingLauncher() {
  const hydrated = useHydrated();
  const [session, setSession] = useState(0);
  const [open, setOpen] = useState(false);
  const start = useCallback(() => {
    setSession((n) => n + 1);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  // Al ocultarse la landing (navegación a /runs) se cierra: si no, al volver se reabriría el formulario anterior.
  useEffect(() => () => setOpen(false), []);
  return (
    <>
      {/* Antes de hidratar un clic no haría nada: el botón se muestra "cargando" en vez de ignorar a la persona. */}
      <Button size="xl" onClick={start} aria-haspopup="dialog" disabled={!hydrated} aria-busy={!hydrated}
        data-ready={hydrated || undefined}>
        Armamos tu viaje <span aria-hidden>→</span>
      </Button>
      <OnboardingModal session={session} open={open} onClose={close} />
    </>
  );
}
