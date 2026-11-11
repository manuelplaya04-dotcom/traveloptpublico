import { z } from "zod";
import { engineFetch } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

// POST /api/client-error: el Error Boundary reporta un error de render. Mismas defensas que /api/trips (solo el
// propio sitio, JSON, sesión) y el motor es quien escribe, con límite por usuario. Nunca devuelve detalles.
const body = z.object({
  message: z.string().min(1).max(500),
  digest: z.string().max(64).nullable().optional(),
  path: z.string().max(200).regex(/^\/[A-Za-z0-9/_-]*$/).nullable().optional(),
}).strict();

const done = () => new Response(null, { status: 204 });

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin) return new Response(null, { status: 403 });
  if (!req.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 415 });
  const raw = await req.text();
  if (raw.length > 2_000) return new Response(null, { status: 413 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return done(); // sin sesión no se registra (y no se le dice nada al navegador)

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 422 });
  try {
    await engineFetch("/v1/client-errors", { method: "POST", body: JSON.stringify({ ...parsed.data, user_id: user.id }) });
  } catch {
    // el reporte es de mejor esfuerzo: si el motor no responde, no hay nada más que hacer
  }
  return done();
}
