import { describe, expect, it } from "vitest";
import { arsFromUsdMinor, dolarApiSchema, pickRates } from "@/lib/fx";
import { photoSrc, photoTarget } from "@/lib/photo";

const ROWS = [
  { moneda: "USD", casa: "oficial", nombre: "Oficial", compra: 1520, venta: 1570, fechaActualizacion: "2026-11-03T18:00:00.000Z" },
  { moneda: "USD", casa: "bolsa", nombre: "Bolsa", compra: 1575.3, venta: 1581.1, fechaActualizacion: "2026-11-03T20:57:00.000Z" },
  { moneda: "USD", casa: "tarjeta", nombre: "Tarjeta", compra: 1976, venta: 2041, fechaActualizacion: "2026-11-03T18:00:00.000Z" },
];

describe("cotización en pesos (dolarapi.com)", () => {
  it("toma dólar tarjeta y MEP (bolsa) de la respuesta real", () => {
    const rates = pickRates(dolarApiSchema.parse(ROWS))!;
    expect(rates.tarjeta.venta).toBe(2041);
    expect(rates.mep.venta).toBe(1581.1);
  });

  it("sin alguna de las dos cotizaciones no hay conversión (no se inventa)", () => {
    expect(pickRates(dolarApiSchema.parse(ROWS.filter((r) => r.casa !== "bolsa")))).toBeNull();
    expect(dolarApiSchema.safeParse([{ casa: "tarjeta", venta: -1, fechaActualizacion: "x" }]).success).toBe(false);
  });

  it("convierte centavos de dólar a pesos enteros", () => {
    expect(arsFromUsdMinor(2_008_362, 2041)).toBe(40_990_668); // USD 20,083.62 al dólar tarjeta
    expect(arsFromUsdMinor(2_008_362, 1581.1)).toBe(31_754_212);
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
