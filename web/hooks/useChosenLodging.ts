"use client";

import { useCart } from "@/components/cart/CartContext";
import { lodgingSlot } from "@/components/city/LodgingFeed";
import type { ItineraryPayload } from "@/lib/types";

type Stay = ItineraryPayload["stays"][number];

/** Alojamiento elegido en el carrito para la estadía (o el óptimo), con su ubicación si el proveedor la informa. null si
 *  la persona no pidió cotizarlo (ya tiene el suyo). */
export function useChosenLodging(stay: Stay) {
  const { cart } = useCart();
  const slot = lodgingSlot(stay.city);
  const id = cart.selected[slot]?.id ?? cart.optimal[slot]?.id ?? stay.lodging?.offer_id;
  const option = stay.lodging_options?.find((o) => o.offer_id === id);
  return option ?? stay.lodging; // misma referencia entre renders: no rompe los useMemo de quien lo usa
}
