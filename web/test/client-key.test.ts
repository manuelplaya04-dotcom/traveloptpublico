import { describe, expect, it } from "vitest";
import { clientKey } from "../lib/clientKey";
import { rateLimitCode } from "../lib/runs";

const h = (o: Record<string, string>) => new Headers(o);
const SECRET = "secreto-de-prueba-de-24-caracteres";

describe("clave seudónima de la conexión", () => {
  it("en Vercel: misma IP, misma clave; 32 hex; la IP no aparece", () => {
    const a = clientKey(h({ "x-real-ip": "203.0.113.7" }), SECRET, true);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(clientKey(h({ "x-real-ip": "203.0.113.7" }), SECRET, true)).toBe(a);
    expect(clientKey(h({ "x-real-ip": "203.0.113.8" }), SECRET, true)).not.toBe(a);
    expect(a).not.toContain("203");
  });

  it("con otro secreto la clave cambia (no se puede precalcular sin el secreto)", () => {
    expect(clientKey(h({ "x-real-ip": "203.0.113.7" }), "otro-secreto-distinto-de-24-car", true))
      .not.toBe(clientKey(h({ "x-real-ip": "203.0.113.7" }), SECRET, true));
  });

  it("fuera de Vercel no confía en headers que el cliente puede inventar", () => {
    expect(clientKey(h({ "x-real-ip": "203.0.113.7" }), SECRET, false)).toBeNull();
  });

  it("sin IP, sin secreto o con basura: sin clave", () => {
    expect(clientKey(h({}), SECRET, true)).toBeNull();
    expect(clientKey(h({ "x-real-ip": "203.0.113.7" }), undefined, true)).toBeNull();
    expect(clientKey(h({ "x-real-ip": "<script>" }), SECRET, true)).toBeNull();
    expect(clientKey(h({ "x-real-ip": "1".repeat(80) }), SECRET, true)).toBeNull();
  });

  it("IPv6 también", () => {
    expect(clientKey(h({ "x-real-ip": "2001:db8::1" }), SECRET, true)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("mensaje según el límite alcanzado", () => {
  it("conexión, sistema o sesión", () => {
    expect(rateLimitCode({ detail: { code: "rate_limited", scope: "client" } })).toBe("rate_limited_client");
    expect(rateLimitCode({ detail: { code: "rate_limited", scope: "global" } })).toBe("rate_limited_global");
    expect(rateLimitCode({ detail: { code: "rate_limited", scope: "user" } })).toBe("rate_limited");
    expect(rateLimitCode(null)).toBe("rate_limited");
    expect(rateLimitCode("basura")).toBe("rate_limited");
  });
});
