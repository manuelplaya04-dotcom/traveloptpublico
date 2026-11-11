// Crear una corrida desde el navegador (onboarding y reordenamiento de ciudades).
import { ZodError } from "zod";
import type { TripRequest } from "@/lib/contracts";
import { ensureSession } from "@/lib/supabase/client";
import { CAPTCHA_ERROR } from "@/lib/turnstile";

// El motor gratuito puede tardar ~1 min en despertar (la función de Vercel espera hasta 60 s): pasado esto se corta.
export const CREATE_RUN_TIMEOUT_MS = 75_000;

// Error esperado al crear una corrida: el mensaje ya está listo para mostrarse a la persona.
export class RunRequestError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "RunRequestError";
  }
}

const MESSAGES: Record<string, string> = {
  rate_limited: "Tenés demasiadas corridas en curso o recientes. Esperá un minuto y volvé a intentar.",
  rate_limited_client: "Superaste el límite de búsquedas por hora desde tu conexión. Probá de nuevo más tarde.",
  rate_limited_global: "Hay muchas búsquedas en curso en este momento. Probá de nuevo en un par de minutos.",
  timeout: "El servidor tardó demasiado en responder. Probá de nuevo en un momento.",
  network: "No pudimos conectarnos. Revisá tu conexión y volvé a intentar.",
  engine_unavailable: "El optimizador no está disponible ahora. Probá de nuevo en unos minutos.",
  orchestrator_not_configured: "El optimizador no está disponible ahora. Probá de nuevo en unos minutos.",
  invalid_request: "Algunos datos del viaje no son válidos. Revisá el formulario.",
  no_session: "Tu sesión venció. Recargá la página y volvé a intentar.",
  empty_response: "El servidor respondió sin crear la búsqueda. Probá de nuevo.",
  cancelled: "Búsqueda cancelada.",
};
const fail = (code: string) => new RunRequestError(MESSAGES[code] ?? "No pudimos crear la búsqueda. Probá de nuevo.", code);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `signal`: quien llama puede cancelar (p. ej. la persona cierra el formulario mientras espera).
export async function createRun(req: TripRequest, signal?: AbortSignal): Promise<string> {
  await ensureSession();
  if (signal?.aborted) throw fail("cancelled");
  let res: Response;
  try {
    res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(CREATE_RUN_TIMEOUT_MS)]) : AbortSignal.timeout(CREATE_RUN_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") throw fail("timeout");
    if (signal?.aborted) throw fail("cancelled");
    if (e instanceof TypeError) throw fail("network"); // fetch rechaza con TypeError si no hay red
    throw e;
  }
  const body: unknown = await res.json().catch(() => null); // cuerpo vacío o no JSON: se trata abajo
  if (res.status === 429) throw fail(rateLimitCode(body));
  if (!res.ok) throw fail(errorCode(body) ?? `http_${res.status}`);
  const runId = (body as { run_id?: unknown } | null)?.run_id;
  if (typeof runId !== "string" || !UUID.test(runId)) throw fail("empty_response");
  return runId;
}

// Mensaje para mostrar al fallar la creación (onboarding, reordenar, re-optimizar actividades). Solo los errores
// esperados muestran su texto; uno inesperado se registra con su traza y la persona ve un mensaje genérico.
export function runErrorMessage(e: unknown): string {
  if (e instanceof RunRequestError) return e.message;
  if (e instanceof ZodError) return MESSAGES.invalid_request;
  if (e instanceof Error && e.message === CAPTCHA_ERROR) return CAPTCHA_ERROR;
  console.error("createRun: error inesperado", e);
  return "No pudimos crear la búsqueda. Probá de nuevo.";
}

// El motor dice qué límite se alcanzó (`detail.scope`): sesión, conexión o el sistema entero.
export function rateLimitCode(body: unknown): string {
  const scope = (body as { detail?: { scope?: unknown } } | null)?.detail?.scope;
  return scope === "client" ? "rate_limited_client" : scope === "global" ? "rate_limited_global" : "rate_limited";
}

function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as { code?: unknown; detail?: { code?: unknown } };
  const code = b.detail?.code ?? b.code;
  return typeof code === "string" ? code : undefined;
}
