"use client";

import { CalendarPlus } from "lucide-react";
import Button from "@/components/ui/Button";
import { cityByCode } from "@/lib/cities";
import { buildIcs } from "@/lib/ics";
import type { ItineraryPayload } from "@/lib/types";

// Descarga un .ics con los vuelos y las estadías del itinerario (Google Calendar, Apple Calendar, Outlook lo importan).
// Se arma en el navegador: no pasa por ningún servidor.
export default function CalendarButton({ payload }: { payload: ItineraryPayload }) {
  const download = () => {
    const ics = buildIcs(payload, (c) => cityByCode(c)?.name ?? c);
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `viaje-${payload.first_checkin}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <Button variant="secondary" onClick={download} data-testid="calendar"><CalendarPlus aria-hidden className="mr-1.5 inline size-4 align-text-bottom" />Agregar al calendario</Button>;
}
