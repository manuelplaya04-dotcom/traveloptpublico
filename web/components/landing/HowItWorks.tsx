const PILLARS = [
  {
    title: "Precio real, al centavo",
    featured: true, // la promesa central: se destaca para guiar la lectura
    body: "Tarifas, valijas, impuestos y cargos de limpieza incluidos. El total que ves es el que pagás.",
  },
  {
    title: "Tus reglas, sin excepciones",
    body: "Baños mínimos, escalas, clima o legalidad del alquiler: si una opción no cumple, queda afuera y te decimos por qué.",
  },
  {
    title: "Todas las combinaciones",
    body: "Fechas, orden de las ciudades y noches en cada una. Probamos todo y elegimos lo óptimo, no lo más popular.",
  },
];

export default function HowItWorks() {
  return (
    <>
      <section id="que-buscamos" className="bg-surface px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Qué buscamos</h2>
          <p className="mt-4 max-w-2xl text-lg text-muted">
            Que armar un viaje con varias ciudades deje de ser una planilla infinita.
          </p>
          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {PILLARS.map((p, i) => (
              <article key={p.title} className={`rounded-3xl bg-white p-8 ${
                "featured" in p ? "shadow-lg ring-2 ring-accent md:-translate-y-2" : "shadow-sm ring-1 ring-line"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-extrabold text-accent">0{i + 1}</span>
                  {"featured" in p && <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">Lo esencial</span>}
                </div>
                <h3 className="mt-3 font-display text-xl font-bold text-ink">{p.title}</h3>
                <p className="mt-3 leading-relaxed text-muted">{p.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="quienes-somos" className="px-6 py-24">
        {/* Bloque centrado y de ancho de lectura: sin columnas desbalanceadas. */}
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Quiénes somos</h2>
          <p className="mt-6 text-lg leading-relaxed text-muted">
            {/* Texto provisorio: reemplazar por la historia real del equipo. */}
            TravelOpt nace de una idea simple: dejar de comparar pestañas. No recomendamos por intuición:
            resuelve un problema matemático con tus datos y te muestra el resultado completo, incluso las opciones
            que descartó.
          </p>
        </div>
      </section>
    </>
  );
}
