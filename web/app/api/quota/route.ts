import { NextResponse } from "next/server";
import { engineFetch } from "@/lib/engine";

// GET /api/quota → saldo de búsquedas de SerpApi para el panel de administración. Doble llave: además de que el
// componente solo se muestra con NEXT_PUBLIC_ADMIN_MODE, esta ruta solo responde si el SERVIDOR tiene ADMIN_MODE=true
// (variable sin prefijo público: nunca llega al navegador). En producción no se define: 404.
export async function GET() {
  if (process.env.ADMIN_MODE !== "true") return NextResponse.json({ code: "not_found" }, { status: 404 });
  try {
    const r = await engineFetch("/v1/quota");
    return NextResponse.json(await r.json(), { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ code: "engine_unavailable" }, { status: 502 });
  }
}
