import { NextResponse } from "next/server";
import { engineFetch } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/share {runId} → link de solo lectura. El motor verifica que la corrida sea de quien pide (uid de la sesión).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "no_session" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { runId?: unknown } | null;
  const runId = typeof body?.runId === "string" && UUID.test(body.runId) ? body.runId : null;
  if (!runId) return NextResponse.json({ code: "invalid_request" }, { status: 422 });
  let r: Response;
  try {
    r = await engineFetch(`/v1/runs/${runId}/share`, { method: "POST", body: JSON.stringify({ uid: user.id }) });
  } catch {
    return NextResponse.json({ code: "engine_unavailable" }, { status: 502 });
  }
  const out = (await r.json().catch(() => ({}))) as { token?: string };
  if (!r.ok || !out.token) return NextResponse.json({ code: "share_failed" }, { status: r.ok ? 502 : r.status });
  return NextResponse.json({ url: `${new URL(req.url).origin}/share/${out.token}` });
}
