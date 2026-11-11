import type { Metadata } from "next";
import type { ReactNode } from "react";
import SiteFooter from "@/components/landing/SiteFooter";
import SiteHeader from "@/components/landing/SiteHeader";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Información legal · TravelOpt",
  description: "Términos de uso, limitación de responsabilidad y privacidad de TravelOpt.",
};

// Modelo de términos y privacidad: no reemplaza asesoramiento legal. Revisar con un abogado antes de publicar.
const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "servicio",
    title: "1. Qué es y qué no es TravelOpt",
    body: (
      <>
        <p>
          {LEGAL.siteName} es una <b>herramienta gratuita, sin fines comerciales y de carácter demostrativo</b>, que te ayuda
          a armar un viaje: compara combinaciones de vuelos, alojamientos, actividades y traslados y calcula un itinerario
          de menor costo según los datos y condiciones que vos ingresás.
        </p>
        <p>
          <b>No somos una agencia de viajes, no vendemos, no reservamos ni cobramos.</b> No intermediamos en ninguna
          compra: los enlaces llevan a sitios de terceros, que son los únicos responsables de sus productos, precios,
          condiciones, cancelaciones y atención.
        </p>
      </>
    ),
  },
  {
    id: "garantias",
    title: "2. Sin garantías: la información puede tener errores",
    body: (
      <>
        <p>
          El servicio se ofrece <b>&quot;tal cual&quot; y &quot;según disponibilidad&quot;</b>, sin garantías de ningún tipo. La
          información puede estar incompleta, desactualizada o contener errores, y el sitio puede tener fallas,
          interrupciones o resultados inexactos.
        </p>
        <ul>
          <li>Los precios, horarios, impuestos y disponibilidad pueden cambiar en cualquier momento hasta que reserves en el proveedor.</li>
          <li>Cuando el sitio indica <i>datos de ejemplo</i>, la información es de prueba y no refleja ofertas reales.</li>
          <li>El clima se basa en promedios históricos y pronósticos de terceros: no garantiza el clima de tu viaje.</li>
          <li>El resultado &quot;óptimo&quot; lo es solo respecto de los datos disponibles y de las condiciones que cargaste.</li>
        </ul>
      </>
    ),
  },
  {
    id: "responsabilidad",
    title: "3. Limitación de responsabilidad",
    body: (
      <p>
        En la máxima medida permitida por la ley aplicable, {LEGAL.siteName} y sus responsables no responden por daños
        directos o indirectos, pérdidas económicas, gastos, cancelaciones, demoras o cualquier perjuicio derivado del uso
        del sitio, de decisiones tomadas en base a su información, de errores u omisiones, ni de los productos o servicios
        de terceros a los que enlaza. Esta limitación no afecta los derechos que la ley de defensa del consumidor no
        permite renunciar.
      </p>
    ),
  },
  {
    id: "viajero",
    title: "4. Lo que queda a cargo del viajero",
    body: (
      <p>
        Antes de comprar, verificá en cada proveedor y en fuentes oficiales: precios finales, condiciones de la tarifa,
        documentación y visas, requisitos sanitarios, seguros, horarios y la legalidad de los alquileres temporarios en
        cada ciudad. Las restricciones que aplica el sitio (por ejemplo, baños mínimos o reglas de alquiler) dependen de
        la información publicada por terceros.
      </p>
    ),
  },
  {
    id: "privacidad",
    title: "5. Privacidad",
    body: (
      <>
        <p>
          No te pedimos nombre, email ni datos de pago. Para que solo vos veas tus búsquedas creamos una
          <b> sesión anónima</b> (identificador aleatorio) mediante cookies técnicas necesarias para el funcionamiento.
          No usamos cookies de publicidad.
        </p>
        <p>
          Guardamos los parámetros de cada búsqueda (destinos, fechas, cantidad de viajeros, presupuesto y condiciones) y
          sus resultados, asociados a esa sesión anónima. Tus elecciones dentro de un resultado se guardan solo en tu
          navegador. Los datos se alojan en proveedores de infraestructura (base de datos y hosting) y se usan únicamente
          para prestar el servicio.
        </p>
        <p>
          Para evitar el uso automatizado del sitio, al crear la sesión usamos{" "}
          <a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener noreferrer">Cloudflare Turnstile</a>,
          que analiza datos técnicos de tu navegador y conexión (por ejemplo, la dirección IP) sin cookies de seguimiento.
        </p>
        <p>
          <b>Tus búsquedas se borran solas a los {LEGAL.retentionDays} días</b>, junto con sus resultados. Lo que elegís
          dentro de un resultado vive solo en tu navegador: para borrarlo antes, eliminá los datos de este sitio desde la
          configuración de tu navegador.
        </p>
        {LEGAL.contactEmail && (
          <p>
            Para consultas sobre tus datos escribí a <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
          </p>
        )}
        <p>Aplica la normativa de protección de datos personales de la {LEGAL.jurisdiction} (Ley 25.326).</p>
      </>
    ),
  },
  {
    id: "terceros",
    title: "6. Marcas, enlaces y atribuciones",
    body: (
      <>
        <p>
          Los nombres de aerolíneas, alojamientos, parques, atracciones y demás marcas pertenecen a sus titulares. Su
          mención es solo descriptiva y no implica afiliación, patrocinio ni respaldo.
        </p>
        <p>
          Datos meteorológicos: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a>,
          bajo licencia CC BY 4.0.
        </p>
      </>
    ),
  },
  {
    id: "cambios",
    title: "7. Cambios y ley aplicable",
    body: (
      <p>
        Podemos modificar estos términos y el servicio en cualquier momento; la versión vigente es la publicada en esta
        página. Usar el sitio implica aceptarlos. Se rigen por las leyes de la {LEGAL.jurisdiction}.
      </p>
    ),
  },
];

export default function LegalPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-10">
        <h1 className="font-display text-4xl font-black tracking-tight text-ink">Información legal</h1>
        <p className="mt-3 text-muted">
          Términos de uso, limitación de responsabilidad y privacidad
          {LEGAL.entity ? ` de ${LEGAL.entity}` : ""}. Última actualización: {LEGAL.updatedAt}.
        </p>
        <nav aria-label="Secciones" className="mt-8 rounded-2xl bg-surface p-5 text-sm">
          <ul className="grid gap-1 sm:grid-cols-2">
            {SECTIONS.map((s) => <li key={s.id}><a href={`#${s.id}`} className="text-accent hover:underline">{s.title}</a></li>)}
          </ul>
        </nav>
        <div className="mt-10 space-y-10">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-6">
              <h2 className="font-display text-xl font-bold text-ink">{s.title}</h2>
              <div className="mt-3 space-y-3 leading-relaxed text-muted [&_a]:text-accent [&_a]:underline [&_b]:text-ink [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
