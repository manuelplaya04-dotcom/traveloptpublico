import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { CATALOG_SNAPSHOT } from "../lib/catalog.snapshot";
import { toCities } from "../lib/catalogRows";
import { activeCities, cityByCode, searchCities, setCatalog } from "../lib/cities";

const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261111130000_city_catalog.sql", import.meta.url), "utf8");

const row = (over: Record<string, unknown> = {}) => ({
  code: "ORL", name: "Orlando", country: "Estados Unidos", airports: ["MCO"], lat: 28.3852, lon: -81.5639,
  default_nights: 7, must_do_by_nights: [0, 0, 1], same_area_as: null, active: true, position: 20,
  catalog_must_do: [{ activity_key: "EPCOT", rank: 2 }, { activity_key: "MK", rank: 1 }], ...over,
});

afterEach(() => setCatalog(CATALOG_SNAPSHOT));

describe("filas del catálogo desde la base", () => {
  it("se convierten al formato de la web, con los imperdibles por prioridad y en el orden del catálogo", () => {
    const cities = toCities([row({ code: "NYC", name: "Nueva York", position: 10, airports: ["JFK"], must_do_by_nights: null, catalog_must_do: [] }), row()]);
    expect(cities.map((c) => c.code)).toEqual(["NYC", "ORL"]);
    expect(cities[1]).toMatchObject({ mustDo: ["MK", "EPCOT"], mustDoByNights: [0, 0, 1], defaultNights: 7, active: true });
    expect(cities[0]).not.toHaveProperty("mustDoByNights");
  });

  it("una fila inválida se descarta sola; una respuesta inválida da lista vacía (y rige la copia de respaldo)", () => {
    expect(toCities([row({ code: "<script>" }), row({ lat: 200 }), row({ airports: [] }), row()]).map((c) => c.code)).toEqual(["ORL"]);
    for (const bad of [null, undefined, "x", 3, { code: "ORL" }]) expect(toCities(bad)).toEqual([]);
  });
});

describe("catálogo vigente", () => {
  it("solo las ciudades activas se pueden buscar; las inactivas existen para nombres viejos", () => {
    expect(activeCities().map((c) => c.code)).not.toContain("LAX");
    expect(searchCities("los angeles")).toEqual([]);
    expect(cityByCode("LAX")?.name).toBe("Los Ángeles");
  });

  it("al llegar el catálogo de la base reemplaza al de respaldo; una lista vacía no deja la web sin destinos", () => {
    setCatalog(toCities([row({ code: "LAX", name: "Los Ángeles", active: true, airports: ["LAX"] })]));
    expect(searchCities("los")[0]?.code).toBe("LAX");
    setCatalog([]);
    expect(activeCities().map((c) => c.code)).toEqual(["LAX"]);
  });
});

describe("la copia de respaldo coincide con la migración que siembra la base", () => {
  // Cada ciudad en el INSERT de catalog_cities: ('NYC', 'Nueva York', 'Estados Unidos', 'us_east', 'America/New_York',
  // '{JFK,LGA,EWR}', 40.758, -73.9855, 4, '{0,2,3}', null, true, 10)
  const seeded = [...MIGRATION.matchAll(
    /\('([A-Z]{3})', '([^']+)', '([^']+)', '(?:us_east|us_west)', '[^']+', '\{([A-Z,]+)\}', (-?[\d.]+), (-?[\d.]+), (\d+), (null|'\{[\d,]+\}'), (null|'[A-Z]+'), (true|false), \d+\)/g)]
    .map((m) => ({
      code: m[1], name: m[2], country: m[3], airports: m[4].split(","), lat: Number(m[5]), lon: Number(m[6]),
      defaultNights: Number(m[7]),
      mustDoByNights: m[8] === "null" ? undefined : m[8].slice(2, -2).split(",").map(Number),
      sameAreaAs: m[9] === "null" ? undefined : m[9].slice(1, -1), active: m[10] === "true",
    }));
  const mustDo = (code: string) => [...MIGRATION.matchAll(new RegExp(`\\('${code}', '([A-Za-z0-9_-]+)', (\\d+)\\)`, "g"))]
    .sort((a, b) => Number(a[2]) - Number(b[2])).map((m) => m[1]);

  it("mismas ciudades, datos e imperdibles", () => {
    expect(seeded.map((c) => c.code).sort()).toEqual(CATALOG_SNAPSHOT.map((c) => c.code).sort());
    for (const s of seeded) {
      const snap = CATALOG_SNAPSHOT.find((c) => c.code === s.code)!;
      const { mustDo: snapMustDo, ...rest } = snap;
      expect({ ...rest, mustDoByNights: rest.mustDoByNights, sameAreaAs: rest.sameAreaAs }, s.code).toEqual(s);
      expect(snapMustDo, s.code).toEqual(mustDo(s.code));
    }
  });
});
