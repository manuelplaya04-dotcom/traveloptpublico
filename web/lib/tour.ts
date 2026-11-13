// Recorridos guiados: pasos anclados a elementos con `data-tour="<target>"`. Datos y persistencia puros (se testean sin
// React); el componente es components/tour/GuidedTour.tsx.

export type TourStep = { target: string; title: string; body: string };
export type Tour = { id: string; steps: readonly TourStep[] };

// Subir la versión vuelve a mostrar un recorrido a quien ya lo vio (cuando cambia lo que explica).
const TOUR_VERSION = 1;
export const tourKey = (id: string) => `travelopt:tour:${id}:v${TOUR_VERSION}`;

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;

/** ¿Ya se mostró? Sin almacenamiento legible (modo privado, bloqueado) cuenta como visto: mejor no mostrarlo que
 *  mostrarlo en cada visita sin poder recordarlo. */
export function hasSeen(store: ReadStore | null, id: string): boolean {
  if (!store) return true;
  try {
    return store.getItem(tourKey(id)) === "1";
  } catch {
    return true;
  }
}

/** Se marca al empezar: aunque la persona cierre a mitad de camino, no vuelve a aparecer. */
export function markSeen(store: WriteStore | null, id: string): void {
  try {
    store?.setItem(tourKey(id), "1");
  } catch {
    // almacenamiento lleno o bloqueado: el recorrido simplemente podrá volver a mostrarse
  }
}

export const tourSelector = (target: string) => `[data-tour="${CSS.escape(target)}"]`;

export const ONBOARDING_TOUR: Tour = {
  id: "onboarding",
  steps: [
    { target: "services", title: "¿Ya tenés pasajes o alojamiento?",
      body: "Desactivá acá lo que ya resolviste: no lo buscamos ni lo sumamos al total, y optimizamos el resto." },
    { target: "destinations", title: "Elegí tus destinos",
      body: "Buscá hasta 4 ciudades en el orden en que las vas a visitar y repartí las noches entre ellas." },
    { target: "stepper", title: "Tres pasos y listo",
      body: "Destinos, fechas y lo que no negociás. Si ninguna opción cumple, te explicamos qué condición la dejó afuera." },
  ],
};

export const RESULTS_TOUR: Tour = {
  id: "results",
  steps: [
    { target: "trip-steps", title: "Recorré tu viaje por partes",
      body: "Cada parte del itinerario tiene su paso, y al final el resumen. Podés cambiar cualquier elección." },
    { target: "subtotal", title: "Tu total, en vivo",
      body: "Cada cambio recalcula el total al centavo y te avisa si te pasás del presupuesto." },
    { target: "trip-actions", title: "Llevátelo",
      body: "Agregalo a tu calendario, compartilo con un link o guardalo en PDF." },
  ],
};

export const INFEASIBLE_TOUR: Tour = {
  id: "infeasible",
  steps: [
    { target: "explanation", title: "¿Por qué no hubo resultados?",
      body: "Acá te explicamos qué condición dejó afuera las opciones y, si lo calculamos, qué cambio alcanza para tener viaje." },
  ],
};
