import { NextResponse } from "next/server";
import { cityByCode } from "@/lib/cities";
import { engineFetch } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/events?city=ORL&start=YYYY-MM-DD&end=YYYY-MM-DD → eventos de la estadía (vía motor). Solo ciudades del
// catálogo: código y coordenadas salen del servidor, nunca del navegador (no es un proxy abierto).
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "no_session" }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const city = cityByCode(q.get("city") ?? "");
  const [start, end] = [q.get("start") ?? "", q.get("end") ?? ""];
  if (!city || !ISO.test(start) || !ISO.test(end)) {
    return NextResponse.json({ code: "invalid_request" }, { status: 422 });
  }
  const params = new URLSearchParams({ code: city.code, lat: String(city.lat), lon: String(city.lon), start, end,
    uid: user.id });
  let r: Response;
  try {
    r = await engineFetch(`/v1/events?${params}`);
  } catch {
    return NextResponse.json({ code: "engine_unavailable" }, { status: 502 });
  }
  const body = await r.json().catch(() => ({ code: "engine_error" }));
  return NextResponse.json(body, {
    status: r.status,
    headers: r.ok ? { "Cache-Control": "private, max-age=1800" } : undefined,
  });
}
