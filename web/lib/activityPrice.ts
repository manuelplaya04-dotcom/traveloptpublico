import { fmtMinor } from "@/lib/money";

// Cómo se muestra el precio de una actividad según su origen (engine ActivityOffer.price_source):
// provider: precio del proveedor · curated: precio publicado (si varía por fecha, es el mínimo: "desde") ·
// box_office: entrada no publicada (paseo público o taquilla): no se suma ningún monto inventado.
export type PriceSource = "provider" | "curated" | "box_office";
export const BOX_OFFICE_LABEL = "Paseo público / Entrada sujeta a taquilla";

// `fmt`: formateador de la moneda elegida (useMoney); por defecto, USD.
export function activityPriceLabel(minor: number, source: PriceSource | undefined, dateBased: boolean | undefined,
  fmt: (minor: number) => string = fmtMinor): string {
  if (source === "box_office") return BOX_OFFICE_LABEL;
  return dateBased ? `desde ${fmt(minor)}` : fmt(minor);
}

export const activityPriceHint = (source: PriceSource | undefined, dateBased: boolean | undefined) =>
  source === "box_office" ? "Sin precio publicado: no se suma al total; consultá en el lugar"
    : source === "curated" ? `Precio publicado por el lugar${dateBased ? " (varía por fecha: es el mínimo)" : ""}`
      : undefined;
