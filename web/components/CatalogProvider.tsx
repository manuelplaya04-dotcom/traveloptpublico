"use client";

import { useState, type ReactNode } from "react";
import { setCatalog, type CityInfo } from "@/lib/cities";

// Entrega al navegador el catálogo que leyó el servidor. Se aplica en el primer render, antes que los hijos, así
// cityByCode y searchCities ya ven las ciudades de la base en el mismo render (sin parpadeo ni segundo pedido).
export default function CatalogProvider({ cities, children }: { cities: CityInfo[]; children: ReactNode }) {
  useState(() => setCatalog(cities));
  return children;
}
