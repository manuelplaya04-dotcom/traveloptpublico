import { NextResponse } from "next/server";
import { engineFetch } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Los contrafactuales corren el optimizador; con el motor en frío puede tardar.
export const maxDuration = 60;

// GET /api/explanation?runId=… → por qué una búsqueda no tiene resultados, en palabras (vía motor; solo corridas
// propias: el uid sale de la sesión verificada).
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "no_session" }, { status: 401 });
  const runId = new URL(req.url).searchParams.get("runId") ?? "";
  if (!UUID.test(runId)) return NextResponse.json({ code: "invalid_request" }, { status: 422 });
  try {
    const r = await engineFetch(`/v1/runs/${runId}/explanation?${new URLSearchParams({ uid: user.id })}`);
    const body = await r.json().catch(() => ({}));
    // Solo el texto y su origen: los hechos completos son para el motor y los tests, no hace falta mandarlos.
    const out = r.ok ? { text: body.text, source: body.source } : body;
    return NextResponse.json(out, { status: r.status, headers: { "Cache-Control": "private, max-age=600" } });
  } catch {
    return NextResponse.json({ code: "engine_unavailable" }, { status: 502 });
  }
}
