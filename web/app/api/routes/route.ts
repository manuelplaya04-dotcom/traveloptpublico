import { NextResponse } from "next/server";
import { z } from "zod";
import { engineFetch } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

const point = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict();
const bodySchema = z.object({ origin: point, destinations: z.array(point).min(1).max(25) }).strict();

// POST /api/routes {origin, destinations} → distancia y tiempo por calle (vía motor, OSRM con caché permanente).
// El uid sale de la sesión verificada (límite por usuario en el motor), nunca del navegador.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "no_session" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "invalid_request" }, { status: 422 });
  let r: Response;
  try {
    r = await engineFetch("/v1/routes", { method: "POST", body: JSON.stringify({ ...parsed.data, uid: user.id }) });
  } catch {
    return NextResponse.json({ code: "engine_unavailable" }, { status: 502 });
  }
  const body = await r.json().catch(() => ({ code: "engine_error" }));
  return NextResponse.json(body, { status: r.status, headers: r.ok ? { "Cache-Control": "private, max-age=86400" } : undefined });
}
