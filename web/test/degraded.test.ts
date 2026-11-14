import { describe, expect, it } from "vitest";
import { degradedNotices, HISTORICAL_NOTICE, narrowedNotice, quotedAgo, RUN_ERROR_MESSAGE } from "@/lib/format";

describe("degradedNotices", () => {
  it("sin degradación no muestra avisos", () => {
    expect(degradedNotices(undefined)).toEqual([]);
    expect(degradedNotices({})).toEqual([]);
  });

  it("explica cada dato faltante, en orden estable, e ignora tipos desconocidos", () => {
    const out = degradedNotices({ weather: "timeout", activities: "circuit_open", flights: "x" });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/actividades/);
    expect(out[1]).toMatch(/clima/);
  });
});

describe("modo histórico y antigüedad de precios", () => {
  it("con cuota agotada avisa una sola vez y no lo confunde con un dato faltante", () => {
    const out = degradedNotices({ flights: "quota_historical", lodging: "quota_historical", weather: "timeout" });
    expect(out).toEqual([HISTORICAL_NOTICE, expect.stringMatching(/clima/)]);
    expect(degradedNotices({ weather: "quota_historical" })).toEqual([HISTORICAL_NOTICE]);
  });

  it("dice hace cuánto se cotizó cada precio real", () => {
    const now = Date.parse("2026-11-03T20:00:00Z");
    expect(quotedAgo("2026-11-03T19:59:40Z", now)).toBe("Cotizado recién");
    expect(quotedAgo("2026-11-03T19:35:00Z", now)).toBe("Cotizado hace 25 min");
    expect(quotedAgo("2026-11-03T10:00:00+00:00", now)).toBe("Cotizado hace 10 h");
    expect(quotedAgo("2026-10-30T20:00:00Z", now)).toBe("Cotizado hace 4 días");
    expect(quotedAgo(null, now)).toBeNull();
    expect(quotedAgo("no es fecha", now)).toBeNull();
  });

  it("explica la cuota agotada sin códigos internos", () => {
    expect(RUN_ERROR_MESSAGE.quota_exhausted).toMatch(/fechas/);
  });
});

describe("cuota: búsquedas parciales y plan acotado", () => {
  it("una búsqueda parcial avisa qué faltó sin confundirlo con datos ausentes", () => {
    const out = degradedNotices({ flights: "partial_upstream", lodging: "quota_historical" });
    expect(out).toEqual([HISTORICAL_NOTICE, expect.stringMatching(/fechas de vuelos/)]);
  });

  it("explica cada recorte del plan y nada si no hubo recortes", () => {
    expect(narrowedNotice(undefined)).toBeNull();
    expect(narrowedNotice([])).toBeNull();
    const n = narrowedNotice(["flex", "overnight", "rentals"])!;
    expect(n).toMatch(/fecha de ida exacta/);
    expect(n).toMatch(/noche anterior/);
    expect(n).toMatch(/solo hoteles/);
    expect(narrowedNotice(["order"])).toMatch(/solo el orden en que elegiste los destinos/);
  });
});
