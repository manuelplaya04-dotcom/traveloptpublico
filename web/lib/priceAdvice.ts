// Asesor de momento óptimo (engine/app/optimizer/price_advice.py): etiqueta por vuelo según su precio frente al
// historial de 30 días de la misma ruta y fecha. Sin historial suficiente (cold start) el motor no manda nada y no se
// muestra etiqueta.
export type Advice = "opportunity" | "standard" | "wait";
export type AdviceEntry = { advice: Advice; median_minor: number; snapshots: number };

export const ADVICE_LABEL: Record<Advice, string> = {
  opportunity: "Oportunidad (Top 20% más barato)",
  standard: "Precio estándar",
  wait: "Esperar (precio elevado)",
};

export const ADVICE_STYLE: Record<Advice, string> = {
  opportunity: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  standard: "bg-slate-50 text-slate-700 ring-slate-200",
  wait: "bg-orange-50 text-orange-800 ring-orange-200",
};

export const isAdviceMap = (v: unknown): v is Record<string, AdviceEntry> =>
  !!v && typeof v === "object" && Object.values(v).every((e) =>
    !!e && typeof e === "object" && (e as AdviceEntry).advice in ADVICE_LABEL);
