import { Route } from "lucide-react";
import { memo } from "react";

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

// "Optimizar el orden de mi ruta": el motor prueba todos los órdenes de visita (fixed_order: false) y CP-SAT elige el
// más barato. Mismo patrón accesible que los switches de servicios (role="switch", Espacio o Enter lo cambian).
export default memo(function RouteOrderSwitch({ on, cities, onChange }: {
  on: boolean; cities: number; onChange: (on: boolean) => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} data-testid="optimize-order" onClick={() => onChange(!on)}
      aria-describedby="optimize-order-hint"
      className={`flex w-full items-start gap-3 rounded-2xl p-4 text-left ring-1 transition-colors focus-visible:outline-2
        focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? "bg-accent-soft ring-accent" : "bg-white ring-line hover:ring-ink/30"}`}>
      <Route aria-hidden className={`mt-0.5 size-5 shrink-0 ${on ? "text-accent" : "text-muted"}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">Optimizar el orden de mi ruta</span>
        <span id="optimize-order-hint" className="mt-0.5 block text-xs leading-snug text-slate-600 [text-wrap:pretty]">
          {on
            ? `Probamos los ${factorial(cities)} órdenes posibles y te damos el más barato, con las mismas noches en cada ciudad.`
            : "Visitamos las ciudades en el orden de la lista. Activalo y elegimos el recorrido más barato."}
        </span>
      </span>
      <span aria-hidden className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
});
