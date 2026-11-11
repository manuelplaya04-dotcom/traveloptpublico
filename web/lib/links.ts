// Links de reserva: vienen de proveedores externos (JSON del motor), así que se validan antes de renderizarlos.
// Solo https, sin credenciales embebidas y nunca dominios reservados de ejemplo o prueba (RFC 2606/6761): un link
// de relleno no se muestra, en vez de mandar a la persona a una página rota.
const RESERVED_HOSTS = new Set(["example.com", "example.net", "example.org", "localhost"]);
const RESERVED_TLDS = new Set(["example", "test", "invalid", "localhost", "local"]);

export type CompareLink = { label: string; href: string };

const yymmdd = (iso: string) => iso.slice(2, 10).replaceAll("-", "");

/** Dónde comparar o comprar un vuelo: búsquedas reales en plataformas conocidas (sin precios inventados). */
export function flightCompareLinks(f: { origin: string; destination: string; depart_at: string; carrier: string }, pax: number): CompareLink[] {
  const [o, d, day] = [f.origin.toLowerCase(), f.destination.toLowerCase(), f.depart_at.slice(0, 10)];
  const links: CompareLink[] = [
    { label: "Skyscanner", href: `https://www.skyscanner.com.ar/transporte/vuelos/${o}/${d}/${yymmdd(day)}/?adultsv2=${pax}` },
    { label: "Despegar", href: `https://www.despegar.com.ar/shop/flights/results/oneway/${f.origin}/${f.destination}/${day}/${pax}/0/0` },
  ];
  if (f.carrier === "AR") links.push({ label: "Aerolíneas Argentinas", href: "https://www.aerolineas.com.ar/" });
  return links.filter((l) => safeHref(l.href));
}

/** Dónde comparar un alojamiento de la ciudad para esas fechas. */
export function lodgingCompareLinks(city: string, checkIn: string, checkOut: string, pax: number): CompareLink[] {
  const q = encodeURIComponent(city);
  return [
    { label: "Expedia", href: `https://www.expedia.com/Hotel-Search?destination=${q}&startDate=${checkIn}&endDate=${checkOut}&adults=${pax}` },
    { label: "Airbnb", href: `https://www.airbnb.com/s/${q}/homes?checkin=${checkIn}&checkout=${checkOut}&adults=${pax}` },
    { label: "Booking", href: `https://www.booking.com/searchresults.html?ss=${q}&checkin=${checkIn}&checkout=${checkOut}&group_adults=${pax}` },
    { label: "Google Hoteles", href: `https://www.google.com/travel/search?q=${encodeURIComponent(`hoteles en ${city}`)}` },
    { label: "Despegar", href: "https://www.despegar.com.ar/hoteles/" },
  ].filter((l) => safeHref(l.href));
}

export function safeHref(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return undefined; // no es una URL absoluta (incluye "#" y rutas relativas)
  }
  if (url.protocol !== "https:" || url.username || url.password) return undefined; // bloquea javascript:, data:, etc.
  const host = url.hostname.toLowerCase();
  const reserved = [...RESERVED_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
  if (reserved || !host.includes(".") || RESERVED_TLDS.has(host.split(".").pop() ?? "")) return undefined;
  return url.href;
}
