import { describe, expect, it } from "vitest";
import { flightCompareLinks, lodgingCompareLinks } from "../lib/links";
import { dailyLows, fewSeats, groupStats, priceTags, vsAverage } from "../lib/market";

describe("señales de precio (solo con datos de la búsqueda)", () => {
  const prices = [800, 1000, 1200];
  const stats = groupStats(prices);

  it("mejor precio, oferta y diferencia contra el promedio", () => {
    expect(stats).toEqual({ min: 800, avg: 1000 });
    expect(priceTags(800, stats, false, 3)).toEqual(["best", "deal"]); // 20% bajo el promedio
    expect(priceTags(1000, stats, false, 3)).toEqual([]);
    expect(priceTags(1200, stats, true, 3)).toEqual(["scarce"]);
    expect(priceTags(800, groupStats([800]), false, 1)).toEqual([]); // una sola opción: no hay "mejor"
    expect(vsAverage(800, stats)).toBe(-20);
    expect(vsAverage(1200, stats)).toBe(20);
    expect(groupStats([])).toBeUndefined();
  });

  it("últimos lugares cuando los asientos alcanzan justo", () => {
    expect(fewSeats(6, 5)).toBe(true);
    expect(fewSeats(9, 5)).toBe(false);
  });

  it("tendencia: precio mínimo por día en orden", () => {
    expect(dailyLows([{ date: "2027-07-09", price: 5 }, { date: "2027-07-08", price: 7 }, { date: "2027-07-08", price: 3 }]))
      .toEqual([{ date: "2027-07-08", price: 3 }, { date: "2027-07-09", price: 5 }]);
  });
});

describe("links de comparación", () => {
  it("vuelos: Skyscanner y Despegar con ruta, fecha y pasajeros; Aerolíneas solo si opera AR", () => {
    const f = { origin: "EZE", destination: "CDG", depart_at: "2027-07-08T21:30:00", carrier: "AF" };
    expect(flightCompareLinks(f, 5)).toEqual([
      { label: "Skyscanner", href: "https://www.skyscanner.com.ar/transporte/vuelos/eze/cdg/270708/?adultsv2=5" },
      { label: "Despegar", href: "https://www.despegar.com.ar/shop/flights/results/oneway/EZE/CDG/2027-07-08/5/0/0" },
    ]);
    expect(flightCompareLinks({ ...f, carrier: "AR" }, 2).map((l) => l.label)).toContain("Aerolíneas Argentinas");
  });
  it("alojamiento: búsqueda de la ciudad con fechas y huéspedes, nombres codificados", () => {
    const links = lodgingCompareLinks("París", "2027-07-08", "2027-07-13", 2);
    const booking = links.find((l) => l.label === "Booking")!;
    expect(links.map((l) => l.label)).toEqual(expect.arrayContaining(["Expedia", "Airbnb", "Booking"]));
    expect(links.find((l) => l.label === "Airbnb")!.href).toBe("https://www.airbnb.com/s/Par%C3%ADs/homes?checkin=2027-07-08&checkout=2027-07-13&adults=2");
    expect(booking.href).toBe("https://www.booking.com/searchresults.html?ss=Par%C3%ADs&checkin=2027-07-08&checkout=2027-07-13&group_adults=2");
    expect(lodgingCompareLinks("<script>", "a", "b", 1)[0].href).not.toContain("<");
  });
});

describe("sin opciones: qué flexibilizar", () => {
  it("ordena por impacto real del embudo y no repite consejos", async () => {
    const { suggestions } = await import("../lib/suggestions");
    const tips = suggestions({
      rejections: { "lodging.bathrooms": ["a", "b"], "flight.too_many_stops": ["x"] },
      infeasible_skeletons: { s1: "sin_vuelo:tramo_0", s2: "sin_vuelo:tramo_1" }, warnings: [],
    });
    expect(tips[0]).toMatch(/escalas/); // lo que hizo imposible cada fecha pesa más
    expect(tips).toContain("Bajá la cantidad mínima de baños.");
    expect(new Set(tips).size).toBe(tips.length);
    expect(suggestions(undefined)).toEqual([]);
  });
});
