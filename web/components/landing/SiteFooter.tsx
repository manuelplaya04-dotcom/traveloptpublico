import Link from "next/link";

// Pie común: el aviso legal vive acá (no en la portada).
export default function SiteFooter() {
  return (
    <footer className="border-t border-line px-6 py-10 text-sm text-muted">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
        <p>TravelOpt · optimización de itinerarios</p>
        {/* gray-600 sobre blanco: contraste 7.6:1 (WCAG AA y AAA para texto chico). */}
        <nav className="flex gap-6 font-medium text-gray-600 print:hidden">
          <Link href="/legal" className="underline-offset-4 hover:text-ink hover:underline">Información legal</Link>
          <Link href="/legal#privacidad" className="underline-offset-4 hover:text-ink hover:underline">Privacidad</Link>
        </nav>
      </div>
      <p className="mx-auto mt-4 max-w-6xl text-center text-xs sm:text-left">
        Información orientativa: precios y disponibilidad pueden cambiar. No vendemos ni reservamos.
      </p>
    </footer>
  );
}
