import { describe, expect, it } from "vitest";
import { activityPriceLabel, BOX_OFFICE_LABEL } from "@/lib/activityPrice";
import { ADVICE_LABEL, isAdviceMap } from "@/lib/priceAdvice";

describe("precio de actividades sin inventar", () => {
  it("entrada no publicada: paseo público / taquilla, nunca USD 0", () => {
    expect(activityPriceLabel(0, "box_office", false)).toBe(BOX_OFFICE_LABEL);
    expect(activityPriceLabel(0, "box_office", false)).not.toMatch(/USD/);
  });

  it("precio publicado que varía por fecha se muestra como 'desde'", () => {
    expect(activityPriceLabel(15900, "curated", true)).toBe("desde USD 159.00");
    expect(activityPriceLabel(3000, "curated", false)).toBe("USD 30.00");
  });
});

describe("asesor de momento óptimo", () => {
  it("etiquetas de alto impacto", () => {
    expect(ADVICE_LABEL.opportunity).toBe("Oportunidad (Top 20% más barato)");
    expect(ADVICE_LABEL.wait).toMatch(/Esperar/);
  });

  it("solo acepta consejos con forma válida (cold start = vacío)", () => {
    expect(isAdviceMap({})).toBe(true);
    expect(isAdviceMap({ f1: { advice: "opportunity", median_minor: 1, snapshots: 3 } })).toBe(true);
    expect(isAdviceMap({ f1: { advice: "comprá ya" } })).toBe(false);
    expect(isAdviceMap(null)).toBe(false);
  });
});
