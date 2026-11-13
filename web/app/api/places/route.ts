import { NextResponse } from "next/server";
import { ensureCatalog } from "@/lib/catalog";
import { cityByCode } from "@/lib/cities";
import { engineFetch } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

// GET /api/places?city=NYC → lugares reales para visitar (Wikidata vía motor). Solo ciudades del catálogo: las
// coordenadas salen del servidor, nunca del navegador.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "no_session" }, { status: 401 });
  await ensureCatalog();
  const city = cityByCode(new URL(req.url).searchParams.get("city") ?? "");
  if (!city) return NextResponse.json({ code: "invalid_request" }, { status: 422 });
  let r: Response;
  try {
    r = await engineFetch(`/v1/places?${new URLSearchParams({ lat: String(city.lat), lon: String(city.lon), uid: user.id })}`);
  } catch {
    return NextResponse.json({ code: "engine_unavailable" }, { status: 502 });
  }
  const body = await r.json().catch(() => ({ code: "engine_error" }));
  return NextResponse.json(body, { status: r.status, headers: r.ok ? { "Cache-Control": "private, max-age=86400" } : undefined });
}
