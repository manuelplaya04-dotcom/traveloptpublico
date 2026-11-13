import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { AIRPORT_COORDS } from "../lib/airports";
import { CATALOG_SNAPSHOT } from "../lib/catalog.snapshot";
import { toCities } from "../lib/catalogRows";
import { activeCities, cityByCode, scopeGroups, scopeLabel, searchCities, setCatalog } from "../lib/cities";

// Todas las migraciones, en orden: una posterior puede agregar ciudades o activarlas.
const DIR = new URL("../../supabase/migrations/", import.meta.url);
const MIGRATIONS = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, DIR), "utf8"));

const row = (over: Record<string, unknown> = {}) => ({
  code: "ORL", name: "Orlando", country: "Estados Unidos", region: "us_east", currency: "USD", airports: ["MCO"],
  lat: 28.3852, lon: -81.5639,
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
    expect(toCities([row({ code: "<script>" }), row({ lat: 200 }), row({ airports: [] }), row({ region: "asia" }),
      row({ currency: "usd" }), row()]).map((c) => c.code)).toEqual(["ORL"]);
    for (const bad of [null, undefined, "x", 3, { code: "ORL" }]) expect(toCities(bad)).toEqual([]);
  });
});

describe("catálogo vigente", () => {
  it("solo las ciudades activas se pueden buscar; las inactivas existen para nombres viejos", () => {
    expect(activeCities().map((c) => c.code)).toEqual(expect.arrayContaining(["LAX", "SFO", "LAS"]));
    expect(activeCities().map((c) => c.code)).not.toContain("PAR");
    expect(searchCities("paris")).toEqual([]);
    expect(cityByCode("PAR")).toMatchObject({ name: "París", currency: "EUR", region: "europe" });
  });

  it("al llegar el catálogo de la base reemplaza al de respaldo; una lista vacía no deja la web sin destinos", () => {
    setCatalog(toCities([row({ code: "PAR", name: "París", region: "europe", currency: "EUR", airports: ["CDG"] })]));
    expect(searchCities("par")[0]?.code).toBe("PAR");
    setCatalog([]);
    expect(activeCities().map((c) => c.code)).toEqual(["PAR"]);
  });
});

describe("la copia de respaldo coincide con las migraciones que siembran la base", () => {
  // Cada ciudad en un INSERT de catalog_cities: ("NYC", "Nueva York", "Estados Unidos", "us_east", "America/New_York",
  // "{JFK,LGA,EWR}", 40.758, -73.9855, 4, "{0,2,3}", null, true, 10[, "USD"]) — con comillas simples en el SQL. La moneda
  // se agregó después (default USD).
  const city = /\('([A-Z]{3})', '([^']+)', '([^']+)', '(us_east|us_west|europe)', '[^']+', '\{([A-Z,]+)\}', (-?[\d.]+), (-?[\d.]+), (\d+), (null|'\{[\d,]+\}'), (null|'[A-Z]+'), (true|false), \d+(?:, '([A-Z]{3})')?\)/g;
  const activate = /update public\.catalog_cities set active = true where code in \(([^)]+)\)/g;
  const seeded = new Map<string, Record<string, unknown>>();
  for (const sql of MIGRATIONS) {
    for (const m of sql.matchAll(city)) {
      seeded.set(m[1], {
        code: m[1], name: m[2], country: m[3], region: m[4], currency: m[12] ?? "USD", airports: m[5].split(","),
        lat: Number(m[6]), lon: Number(m[7]), defaultNights: Number(m[8]),
        mustDoByNights: m[9] === "null" ? undefined : m[9].slice(2, -2).split(",").map(Number),
        sameAreaAs: m[10] === "null" ? undefined : m[10].slice(1, -1), active: m[11] === "true",
      });
    }
    for (const m of sql.matchAll(activate)) for (const code of m[1].match(/[A-Z]{3}/g) ?? []) seeded.get(code)!.active = true;
  }
  const mustDo = (code: string) => MIGRATIONS.flatMap((sql) => [...sql.matchAll(new RegExp(`\\('${code}', '([A-Za-z0-9_-]+)', (\\d+)\\)`, "g"))])
    .sort((a, b) => Number(a[2]) - Number(b[2])).map((m) => m[1]);

  it("mismas ciudades, datos, moneda, región, estado e imperdibles", () => {
    expect(seeded.size).toBeGreaterThanOrEqual(12); // las expresiones siguen encontrando las filas sembradas
    expect([...seeded.keys()].sort()).toEqual(CATALOG_SNAPSHOT.map((c) => c.code).sort());
    for (const s of seeded.values()) {
      const snap = CATALOG_SNAPSHOT.find((c) => c.code === s.code)!;
      const { mustDo: snapMustDo, ...rest } = snap;
      expect({ ...rest, mustDoByNights: rest.mustDoByNights, sameAreaAs: rest.sameAreaAs }, String(s.code)).toEqual(s);
      expect(snapMustDo, String(s.code)).toEqual(mustDo(String(s.code)));
    }
  });
});

describe("alcance de la beta", () => {
  const only = (...regions: string[]) => CATALOG_SNAPSHOT.map((c) => ({ ...c, active: regions.includes(c.region) }))
    .filter((c) => c.active);
  it("un renglón por región, en orden, con sus ciudades", () => {
    expect(scopeGroups(activeCities()).map((g) => g.title)).toEqual(["Costa Este de EE. UU.", "Costa Oeste de EE. UU."]);
    expect(scopeGroups(activeCities())[1].cities).toBe("Los Ángeles, San Francisco y Las Vegas");
    expect(scopeGroups(only("us_east", "us_west", "europe")).map((g) => g.region)).toEqual(["us_east", "us_west", "europe"]);
    expect(scopeGroups([])).toEqual([]);
  });

  it("se arma con las regiones activas", () => {
    expect(scopeLabel(only("us_east"))).toBe("la Costa Este de EE. UU.");
    expect(scopeLabel(only("us_east", "us_west"))).toBe("la Costa Este y la Costa Oeste de EE. UU.");
    expect(scopeLabel(only("us_east", "us_west", "europe"))).toBe("la Costa Este y la Costa Oeste de EE. UU. y Europa");
    expect(scopeLabel(activeCities())).toBe("la Costa Este y la Costa Oeste de EE. UU.");
  });
});

describe("datos por ciudad activa", () => {
  it("todo aeropuerto de una ciudad activa tiene coordenadas (traslado por calle desde el alojamiento)", () => {
    const missing = activeCities().flatMap((c) => c.airports).filter((a) => !AIRPORT_COORDS[a]);
    expect(missing).toEqual([]);
  });
});
