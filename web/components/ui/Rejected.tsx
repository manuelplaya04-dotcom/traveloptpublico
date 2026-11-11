import type { ReactNode } from "react";

// Opciones descartadas plegadas debajo de las elegibles: siguen a mano (con su motivo) sin ocupar la grilla principal.
export default function Rejected({ count, children }: { count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-muted ring-1 ring-line hover:text-ink">
        Ver {count} descartada{count > 1 ? "s" : ""} y por qué
        <span className="transition group-open:rotate-180" aria-hidden>⌄</span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
