import "server-only";
import { CATALOG_SNAPSHOT } from "@/lib/catalog.snapshot";
import { SELECT, toCities } from "@/lib/catalogRows";
import { setCatalog, type CityInfo } from "@/lib/cities";

// Catálogo de destinos desde Supabase (lectura pública protegida por RLS; nadie fuera del motor puede escribirlo).
// Se lee en el servidor con la clave pública, se valida fila por fila y se guarda 5 min por instancia. Si la base no
// responde a tiempo o devuelve algo inválido, se usa la copia de respaldo: la web nunca se queda sin destinos.
const TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 2_500;

let memo: { at: number; cities: CityInfo[] } | null = null;

export async function loadCatalog(now = Date.now()): Promise<CityInfo[]> {
  if (memo && now - memo.at < TTL_MS) return memo.cities;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let cities: CityInfo[] = [];
  if (base && key) {
    try {
      const r = await fetch(`${base}/rest/v1/catalog_cities?select=${SELECT}`, {
        headers: { apikey: key }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.ok) cities = toCities(await r.json());
    } catch {
      cities = []; // red caída, timeout o JSON roto: se sigue con la copia de respaldo
    }
  }
  if (cities.length === 0) return memo?.cities ?? CATALOG_SNAPSHOT; // no se cachea la falla: el próximo pedido reintenta
  memo = { at: now, cities };
  return cities;
}

/** Carga el catálogo y lo deja disponible para cityByCode/searchCities en este servidor. Devuelve lo cargado. */
export async function ensureCatalog(): Promise<CityInfo[]> {
  const cities = await loadCatalog();
  setCatalog(cities);
  return cities;
}
