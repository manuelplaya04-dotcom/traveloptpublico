"use client";

import { MapPin } from "lucide-react";
import { memo, type MouseEvent } from "react";
import { focusOnMap, type MapFocus } from "@/lib/mapFocus";

// Botón secundario "📍 Ver en mapa" de las tarjetas. No toca estado de React: avisa al mapa de la ciudad por el bus de
// lib/mapFocus, así que la lista no se redibuja. stopPropagation + preventDefault: dentro de una tarjeta que es un
// <label> (actividades) no debe marcar el checkbox, y nunca dispara el "Seleccionar" de la tarjeta.
// `inline`: versión texto para filas de datos angostas (tarjetas de actividad), sin aro ni padding.
export default memo(function MapButton({ focus, className = "", inline = false }: {
  focus: MapFocus | null; className?: string; inline?: boolean;
}) {
  if (!focus) return null; // sin ubicación real no se ofrece (nada de geocodificar)
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    focusOnMap(focus);
  };
  return (
    <button type="button" onClick={onClick} data-testid="map-focus-button" aria-label={`Ver en mapa: ${focus.label}`} // WCAG 2.5.3: el nombre empieza con el texto visible
      className={`${inline ? "inline-flex items-center gap-0.5 whitespace-nowrap font-medium text-accent transition-colors duration-300 hover:underline"
        : "inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold text-accent ring-1 ring-accent/30 transition-colors duration-300 hover:bg-accent-soft hover:ring-accent"} print:hidden ${className}`}>
      <MapPin aria-hidden className="size-3.5" /> Ver en mapa
    </button>
  );
});
