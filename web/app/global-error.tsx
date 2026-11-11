"use client";

// Último recurso: si falla el layout raíz, reemplaza todo el documento (por eso trae <html> y <body> propios).
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "4rem 1.5rem", textAlign: "center", color: "#111827" }}>
        <h1 style={{ fontSize: "1.5rem" }}>TravelOpt no pudo cargar</h1>
        <p style={{ color: "#4b5563" }}>Probá de nuevo en unos segundos.</p>
        <button type="button" onClick={reset}
          style={{ marginTop: "1rem", padding: "0.6rem 1.4rem", borderRadius: 999, border: 0, background: "#4f46e5", color: "#fff", fontWeight: 600 }}>
          Reintentar
        </button>
      </body>
    </html>
  );
}
