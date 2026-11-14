import { describe, expect, it } from "vitest";
import { arsFromUsdMinor, engineFxSchema, fmtArs, moneyFormat, type FxRates } from "@/lib/fx";
import { photoSrc, photoTarget } from "@/lib/photo";

// Respuesta del motor (GET /v1/fx/ars): centavos de peso por dólar, enteros.
const RATES: FxRates = {
  tarjeta: { cents_per_usd: 204100, updated_at: "2026-11-03T18:00:00Z" },
  mep: { cents_per_usd: 158110, updated_at: "2026-11-03T20:57:00Z" },
  source: "dolarapi.com", fetched_at: "2026-11-03T21:00:00Z", stale: false,
};

describe("precios en pesos (cotización del motor)", () => {
  it("valida la respuesta: sin las dos cotizaciones enteras y positivas no hay conversión", () => {
    expect(engineFxSchema.parse(RATES)).toEqual(RATES);
    expect(engineFxSchema.safeParse({ ...RATES, mep: undefined }).success).toBe(false);
    expect(engineFxSchema.safeParse({ ...RATES, tarjeta: { ...RATES.tarjeta, cents_per_usd: 2041.5 } }).success).toBe(false);
    expect(engineFxSchema.safeParse({ ...RATES, tarjeta: { ...RATES.tarjeta, cents_per_usd: -1 } }).success).toBe(false);
  });

  it("convierte centavos de dólar a pesos enteros con aritmética entera (half-up, simétrica)", () => {
    expect(arsFromUsdMinor(2_008_362, 204100)).toBe(40_990_668); // USD 20,083.62 al dólar tarjeta
    expect(arsFromUsdMinor(2_008_362, 158110)).toBe(31_754_212);
    expect(arsFromUsdMinor(1, 5000)).toBe(1); // 0,5 peso -> 1
    expect(arsFromUsdMinor(-1, 5000)).toBe(-1);
    expect(arsFromUsdMinor(0, 204100)).toBe(0);
    expect(arsFromUsdMinor(Number.MAX_SAFE_INTEGER, 204100)).toBeNull(); // no exacto: no se muestra un número dudoso
  });

  it("formato argentino: punto para miles; en USD sigue el formato del motor", () => {
    expect(fmtArs(40_990_668).replace(/\s/g, " ")).toBe("$ 40.990.668");
    expect(moneyFormat("tarjeta", RATES)(2_008_362).replace(/\s/g, " ")).toBe("$ 40.990.668");
    expect(moneyFormat("mep", RATES)(-150).replace(/\s/g, " ")).toBe("-$ 2.372"); // -USD 1.50 × 1.581,10
    expect(moneyFormat("USD", RATES)(2_008_362)).toBe("USD 20,083.62");
  });

  it("sin cotización los precios siguen en USD (fallback silencioso, nunca vacío)", () => {
    expect(moneyFormat("tarjeta", null)(2_008_362)).toBe("USD 20,083.62");
    expect(moneyFormat("mep", RATES)(Number.MAX_SAFE_INTEGER)).toMatch(/^USD /);
  });
});

describe("fotos por el proxy propio", () => {
  it("solo miniaturas de Google por https", () => {
    expect(photoTarget("https://lh3.googleusercontent.com/abc=s287")).not.toBeNull();
    expect(photoTarget("http://lh3.googleusercontent.com/abc")).toBeNull();
    expect(photoTarget("https://evil.example/x.jpg")).toBeNull();
    expect(photoTarget("https://user:pw@lh3.googleusercontent.com/x")).toBeNull();
    expect(photoTarget("https://lh3.googleusercontent.com:8443/x")).toBeNull();
    expect(photoTarget(null)).toBeNull();
  });

  it("el src siempre apunta al sitio, nunca al host de terceros", () => {
    expect(photoSrc("https://lh3.googleusercontent.com/a b")).toBe("/api/photo?u=https%3A%2F%2Flh3.googleusercontent.com%2Fa%20b");
    expect(photoSrc("https://evil.example/x.jpg")).toBeNull();
  });
});
