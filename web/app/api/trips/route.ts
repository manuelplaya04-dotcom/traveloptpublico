import { NextResponse } from "next/server";
import { tripRequestSchema } from "@/lib/contracts";
import { clientKey } from "@/lib/clientKey";
import { engineFetch } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

const MAX_BODY_BYTES = 64 * 1024; // mismo tope que el motor

// El motor del plan gratuito puede tardar hasta ~1 min en despertar: la función espera en vez de cortar a los 10 s.
export const maxDuration = 60;

const fail = (status: number, code: string, extra: object = {}) =>
  NextResponse.json({ code, ...extra }, { status });

// POST /api/trips: valida (UX), identifica al usuario y delega en el motor, que crea la corrida y dispara n8n.
export async function POST(req: Request) {
  // CSRF: solo desde el propio sitio y como JSON (un <form> cross-site no puede mandar application/json).
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin) return fail(403, "bad_origin");
  if (!req.headers.get("content-type")?.startsWith("application/json")) return fail(415, "json_required");

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return fail(413, "payload_too_large");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "no_session");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail(400, "invalid_json");
  }
  const parsed = tripRequestSchema.safeParse(json);
  if (!parsed.success) return fail(422, "invalid_request", { issues: parsed.error.issues });

  let r: Response;
  try {
    const key = clientKey(req.headers, process.env.ENGINE_API_KEY);
    r = await engineFetch("/v1/runs", {
      method: "POST",
      body: JSON.stringify({ trip_request: parsed.data, user_id: user.id }),
      headers: key ? { "X-Client-Key": key } : undefined, // límite por conexión, sin mandar la IP
    });
  } catch {
    return fail(502, "engine_unavailable"); // sin detalles internos hacia el navegador
  }
  const body = await r.json().catch(() => ({ code: "engine_error" }));
  const retryAfter = r.headers.get("Retry-After");
  return NextResponse.json(body, {
    status: r.status,
    headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
  });
}
