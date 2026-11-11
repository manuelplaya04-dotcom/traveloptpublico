import { NextResponse } from "next/server";
import { engineFetch } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/price-advice?runId=… → asesor de momento óptimo por vuelo (vía motor; solo corridas propias: el uid sale
// de la sesión verificada).
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "no_session" }, { status: 401 });
  const runId = new URL(req.url).searchParams.get("runId") ?? "";
  if (!UUID.test(runId)) return NextResponse.json({ code: "invalid_request" }, { status: 422 });
  try {
    const r = await engineFetch(`/v1/runs/${runId}/price-advice?${new URLSearchParams({ uid: user.id })}`);
    return NextResponse.json(await r.json().catch(() => ({})), { status: r.status, headers: { "Cache-Control": "private, max-age=600" } });
  } catch {
    return NextResponse.json({ code: "engine_unavailable" }, { status: 502 });
  }
}
