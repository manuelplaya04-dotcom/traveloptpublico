// Cuando no hay itinerario, qué flexibilizar: sale de los motivos reales del embudo del motor (nunca de datos de
// rescate). Se ordena por cuántas opciones descartó cada motivo y se devuelven los consejos más útiles, sin repetir.
import type { Run } from "@/lib/types";

type Diagnostics = NonNullable<Run["summary"]["diagnostics"]>;

const TIP: Record<string, string> = {
  "flight.too_many_stops": "Permití al menos 1 escala: muchas rutas no tienen vuelo directo ese día.",
  "flight.insufficient_seats": "Probá con menos viajeros o con otras fechas: no quedan asientos para todo el grupo.",
  "flight.arrives_too_late": "Probá otras fechas o permití escalas: los vuelos llegan demasiado tarde.",
  "flight.departs_too_early": "Probá otras fechas: los vuelos salen demasiado temprano.",
  "lodging.bathrooms": "Bajá la cantidad mínima de baños.",
  "lodging.bedrooms": "Bajá la cantidad mínima de dormitorios.",
  "lodging.kitchen_unknown": "Desactivá \"Exigir cocina\": la mayoría de los hoteles no informa si tiene cocina.",
  "lodging.no_kitchen": "Desactivá \"Exigir cocina\": los alojamientos disponibles no tienen.",
  "activity.weather_rain": "Subí la tolerancia a la lluvia para actividades al aire libre.",
  "lodging.capacity": "Probá con menos viajeros o con más baños/dormitorios flexibles: no hay alojamiento para el grupo.",
  "lodging.min_nights": "Sumá noches en esa ciudad: los alojamientos piden una estadía mínima mayor.",
  sin_vuelo: "Permití escalas o probá otras fechas: no encontramos vuelos para algún tramo.",
  sin_alojamiento: "Bajá la cantidad mínima de baños o sumá noches: no hay alojamiento que cumpla.",
  actividades_infactibles: "Sumá noches o subí la tolerancia a la lluvia: los imperdibles no entran en los días disponibles.",
};

export function suggestions(d: Diagnostics | undefined, max = 3): string[] {
  if (!d) return [];
  const weight = new Map<string, number>();
  for (const [reason, items] of Object.entries(d.rejections)) weight.set(reason, (weight.get(reason) ?? 0) + items.length);
  for (const reason of Object.values(d.infeasible_skeletons)) {
    const key = reason.split(":")[0];
    weight.set(key, (weight.get(key) ?? 0) + 1000); // lo que hizo imposible cada fecha pesa más que un descarte suelto
  }
  const tips = [...weight].sort((a, b) => b[1] - a[1]).map(([k]) => TIP[k]).filter((t): t is string => !!t);
  return [...new Set(tips)].slice(0, max);
}
