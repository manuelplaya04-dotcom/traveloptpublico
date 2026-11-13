import { NextResponse } from "next/server";
import { ensureCatalog } from "@/lib/catalog";
import { cityByCode } from "@/lib/cities";
import { engineFetch } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/weather?city=ORL&start=YYYY-MM-DD&end=YYYY-MM-DD → histórico año por año + pronóstico (vía motor).
// Solo ciudades del catálogo: las coordenadas salen del servidor, nunca del navegador (no es un proxy abierto).
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "no_session" }, { status: 401 });

  const q = new URL(req.url).searchParams;
  await ensureCatalog();
  const city = cityByCode(q.get("city") ?? "");
  const [start, end] = [q.get("start") ?? "", q.get("end") ?? ""];
  if (!city ||!ISO.test(start) || !ISO.test(end)) {
    return NextResponse.json({ code: "invalid_request" }, { status: 422 });
  }

  // uid: el motor limita el "Ver más" por usuario (sale de la sesión verificada, nunca del navegador).
  const params = new URLSearchParams({ lat: String(city.lat), lon: String(city.lon), start, end, uid: user.id });
  let r: Response;
  try {
    r = await engineFetch(`/v1/weather/insights?${params}`);
  } catch {
    return NextResponse.json({ code: "engine_unavailable" }, { status: 502 });
  }
  const body = await r.json().catch(() => ({ code: "engine_error" }));
  return NextResponse.json(body, {
    status: r.status,
    headers: r.ok ? { "Cache-Control": "private, max-age=1800" } : undefined,
  });
}
