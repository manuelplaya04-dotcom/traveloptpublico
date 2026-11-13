import { z } from "zod";
import type { CityInfo } from "@/lib/cities";

// Validación y conversión de las filas del catálogo (catalog_cities + catalog_must_do) al formato de la web. Pura,
// sin acceso a red: la usan lib/catalog.ts y los tests.
export const SELECT = "code,name,country,region,currency,airports,lat,lon,default_nights,must_do_by_nights,same_area_as,active,position," +
  "catalog_must_do(activity_key,rank)";

const rowSchema = z.object({
  code: z.string().regex(/^[A-Z]{2,5}$/),
  name: z.string().min(1).max(40),
  country: z.string().min(1).max(60),
  region: z.enum(["us_east", "us_west", "europe"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  airports: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1).max(5),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  default_nights: z.number().int().min(1).max(21),
  must_do_by_nights: z.array(z.number().int().min(0)).nullable(),
  same_area_as: z.string().nullable(),
  active: z.boolean(),
  position: z.number().int(),
  catalog_must_do: z.array(z.object({ activity_key: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), rank: z.number().int() })),
});

export function toCities(rows: unknown): CityInfo[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    const p = rowSchema.safeParse(r);
    return p.success ? [p.data] : []; // una fila inválida se descarta sola; el resto del catálogo sigue
  }).sort((a, b) => a.position - b.position || a.code.localeCompare(b.code)).map((r) => ({
    code: r.code, name: r.name, country: r.country, region: r.region, currency: r.currency, airports: r.airports, lat: r.lat, lon: r.lon,
    mustDo: [...r.catalog_must_do].sort((a, b) => a.rank - b.rank).map((m) => m.activity_key),
    ...(r.must_do_by_nights ? { mustDoByNights: r.must_do_by_nights } : {}),
    ...(r.same_area_as ? { sameAreaAs: r.same_area_as } : {}),
    defaultNights: r.default_nights, active: r.active,
  }));
}

