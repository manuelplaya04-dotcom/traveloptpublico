import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tripRequestSchema } from "../lib/contracts";
import { fmtMinor, toMinor } from "../lib/money";
import demo from "../lib/demo-case.json";

const root = resolve(process.cwd(), ".."); // npm test corre desde web/

describe("money", () => {
  it("formatea igual que el motor", () => {
    expect(fmtMinor(2008362)).toBe("USD 20,083.62");
    expect(fmtMinor(5)).toBe("USD 0.05");
    expect(fmtMinor(-63638)).toBe("-USD 636.38");
  });
  it("convierte unidades a centavos enteros", () => {
    expect(toMinor(21000)).toBe(2100000);
    expect(toMinor(0.1 + 0.2)).toBe(30);
  });
});

describe("contrato", () => {
  it("el caso demo del frontend es idéntico al fixture del motor", () => {
    const engineCase = JSON.parse(readFileSync(resolve(root, "engine/fixtures/orlando_nyc_5pax/trip_request.json"), "utf8"));
    expect(demo).toEqual(engineCase);
  });
  it("zod acepta el fixture", () => {
    expect(tripRequestSchema.safeParse(demo).success).toBe(true);
  });
  it("zod cubre todas las propiedades del JSON Schema de Pydantic", () => {
    const schema = JSON.parse(readFileSync(resolve(root, "contracts/TripRequest.schema.json"), "utf8"));
    expect(Object.keys(tripRequestSchema.shape).sort()).toEqual(Object.keys(schema.properties).sort());
  });
});
