import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { safeHref } from "../lib/links";

vi.mock("../lib/supabase/client", () => ({ ensureSession: vi.fn().mockResolvedValue({}) }));
const { createRun, runErrorMessage, RunRequestError } = await import("../lib/runs");

describe("links de reserva", () => {
  it("solo renderiza URLs https reales", () => {
    expect(safeHref("https://www.booking.com/searchresults.html?ss=Kissimmee")).toBe(
      "https://www.booking.com/searchresults.html?ss=Kissimmee");
    for (const bad of [
      undefined, null, "", "#", "/runs/x", "http://booking.com/", "javascript:alert(1)", "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>", "https://example.com/fixture/H1", "https://sub.example.org/",
      "https://shop.test/", "https://localhost/", "https://intranet/", "https://user:pw@booking.com/",
    ]) expect(safeHref(bad), String(bad)).toBeUndefined();
  });

  it("el fixture del motor no trae links de relleno", () => {
    for (const f of ["flights", "lodging", "activities", "transport"]) {
      const raw = JSON.parse(readFileSync(resolve(__dirname, `../../engine/fixtures/orlando_nyc_5pax/${f}.json`), "utf8"));
      const links = JSON.stringify(raw).match(/"deeplink":"[^"]*"/g) ?? [];
      for (const l of links) expect(safeHref(l.slice(12, -1)), `${f}: ${l}`).toBeDefined();
    }
  });
});

describe("crear corrida", () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body === undefined ? "" : JSON.stringify(body), { status })));
  const req = {} as Parameters<typeof createRun>[0];

  it("devuelve el id de la corrida", async () => {
    respond(202, { run_id: "5ac9634e-7e08-4ccc-af3c-78f909e13f9c" });
    await expect(createRun(req)).resolves.toBe("5ac9634e-7e08-4ccc-af3c-78f909e13f9c");
  });

  it("una respuesta vacía o sin id es un error legible, no un /runs/undefined", async () => {
    respond(202, undefined);
    await expect(createRun(req)).rejects.toThrow(/sin crear la búsqueda/);
    respond(202, { run_id: "<img src=x onerror=alert(1)>" });
    await expect(createRun(req)).rejects.toBeInstanceOf(RunRequestError);
  });

  it("traduce los códigos del servidor y los cortes de red", async () => {
    respond(502, { code: "engine_unavailable" });
    await expect(createRun(req)).rejects.toThrow(/no está disponible/);
    respond(429, {});
    await expect(createRun(req)).rejects.toThrow(/demasiadas corridas/);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(createRun(req)).rejects.toThrow(/conexión/);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("t", "TimeoutError")));
    await expect(createRun(req)).rejects.toThrow(/tardó demasiado/);
  });

  it("un error inesperado no expone detalles internos", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runErrorMessage(new Error("ZodError: [ { path: total_nights_min } ]"))).toBe("No pudimos crear la búsqueda. Probá de nuevo.");
  });
});

describe("crear corrida cancelable", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("si la persona cancela, no navega ni muestra un error de red", async () => {
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_, rej) =>
      init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))));
    const ctl = new AbortController();
    const p = createRun({} as Parameters<typeof createRun>[0], ctl.signal);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ code: "cancelled" });
  });
});
