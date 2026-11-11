import { describe, expect, it } from "vitest";
import { parseExplanation } from "../lib/explanation";

describe("respuesta del explicador del embudo", () => {
  it("acepta texto y origen válidos", () => {
    expect(parseExplanation({ text: " Con 1 escala hay viaje. ", source: "ai" })).toEqual({ text: "Con 1 escala hay viaje.", source: "ai" });
    expect(parseExplanation({ text: "x", source: "rules", extra: 1 })).toEqual({ text: "x", source: "rules" });
  });

  it("cualquier otra forma se descarta sin romper", () => {
    for (const body of [null, undefined, "texto", 3, {}, { text: "" }, { text: "   ", source: "ai" },
      { text: "ok", source: "otra" }, { text: 5, source: "ai" }, { text: "a".repeat(901), source: "ai" },
      { code: "engine_unavailable" }]) {
      expect(parseExplanation(body)).toBeNull();
    }
  });
});
