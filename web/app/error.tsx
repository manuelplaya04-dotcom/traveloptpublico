"use client";

import Link from "next/link";
import { useEffect } from "react";
import Alert from "@/components/ui/Alert";

// Error Boundary de las páginas: si un render falla (datos inesperados, bug), la persona ve qué pasó y puede
// reintentar, sin pantalla en blanco ni datos inventados. El detalle técnico va a la consola, nunca a la pantalla.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("render falló", error);
    reportError(error);
  }, [error]);
  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-20">
      <Alert tone="danger">
        <p>Algo salió mal al mostrar esta página.</p>
        <p className="mt-1 font-normal">Tus datos no se perdieron. Probá de nuevo o armá un viaje nuevo.</p>
        {error.digest && <p className="mt-2 text-xs font-normal opacity-70">Código: {error.digest}</p>}
      </Alert>
      <div className="flex gap-3">
        <button type="button" onClick={reset}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover">Reintentar</button>
        <Link href="/" className="rounded-full px-5 py-2.5 text-sm font-semibold text-accent shadow-sm hover:bg-surface">Nuevo viaje</Link>
      </div>
    </main>
  );
}

// Reporte de mejor esfuerzo al motor (vía /api/client-error): solo mensaje, digest y ruta, sin datos del viaje.
function reportError(error: Error & { digest?: string }) {
  const path = location.pathname.replace(/[^A-Za-z0-9/_-]/g, "").slice(0, 200) || "/";
  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: (error.message || "error").slice(0, 500), digest: error.digest?.slice(0, 64), path }),
    keepalive: true,
  }).catch(() => {});
}
