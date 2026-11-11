import OnboardingLauncher from "@/components/onboarding/OnboardingLauncher";

// Íconos de trazo fino en línea (estilo Lucide), sin dependencia ni JS en el cliente: la landing es Server Component.
const ICON: Record<string, string> = {
  Vuelos: "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",
  Alojamiento: "M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8 M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4 M12 4v6 M2 18h20",
  Actividades: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 12 2.5a7 7 0 0 1 7 7C19 14.8 12 21 12 21z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  Traslados: "M5 17h14v-5l-2-5H7l-2 5v5z M5 12h14 M7.5 17v2 M16.5 17v2 M8 14.5h.01 M16 14.5h.01",
};

export default function Hero() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col items-center px-6 pb-28 pt-16 text-center sm:pt-24">
      {/* Badge informativo (no interactivo): lista estática, sin hover ni cursor de botón. */}
      <ul aria-label="Qué incluye" className="mb-6 flex flex-wrap justify-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-2 text-sm text-muted">
        {Object.entries(ICON).map(([label, d]) => (
          <li key={label} className="flex items-center gap-1.5">
            <svg aria-hidden viewBox="0 0 24 24" className="size-4 text-accent" fill="none" stroke="currentColor"
              strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
            {label}
          </li>
        ))}
      </ul>
      <h1 className="font-display text-4xl font-black leading-[1.05] tracking-tight text-ink sm:text-6xl md:text-7xl">
        El viaje que querés,<br className="hidden sm:block" /> al menor costo posible.
      </h1>
      <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
        Nos decís adónde, cuándo y qué no negociás. Comparamos todas las combinaciones y te devolvemos el
        itinerario más barato que cumple cada una de tus condiciones, con el detalle de cada peso.
      </p>
      <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row">
        <OnboardingLauncher />
        <a href="#que-buscamos"
          className="rounded-full border border-line px-6 py-3 text-base font-semibold text-ink transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          Cómo funciona ↓
        </a>
      </div>
      <p className="mt-6 text-sm text-muted">Sin registro. Toma menos de un minuto.</p>
    </section>
  );
}
