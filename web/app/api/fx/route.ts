import { NextResponse } from "next/server";
import { dolarApiSchema, pickRates, type FxRates } from "@/lib/fx";

// GET /api/fx -> dólar tarjeta y MEP para mostrar el viaje en pesos. Host fijo (sin SSRF) y respuesta validada; el
// navegador nunca llama a dolarapi.com. Caché en memoria de 30 min: unas pocas consultas por hora como mucho.
const UPSTREAM = "https://dolarapi.com/v1/dolares";
const TTL_MS = 30 * 60 * 1000;
let cached: { at: number; rates: FxRates } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) return ok(cached.rates);
  try {
    const r = await fetch(UPSTREAM, { redirect: "error", signal: AbortSignal.timeout(5_000) });
    const parsed = r.ok ? dolarApiSchema.safeParse(await r.json()) : null;
    const rates = parsed?.success ? pickRates(parsed.data) : null;
    if (!rates) throw new Error("respuesta inesperada");
    cached = { at: Date.now(), rates };
    return ok(rates);
  } catch {
    // Degradación elegante: si hay una cotización anterior se sirve; si no, la web oculta la sección.
    return cached ? ok(cached.rates) : NextResponse.json({ code: "fx_unavailable" }, { status: 503 });
  }
}

const ok = (rates: FxRates) =>
  NextResponse.json(rates, { headers: { "Cache-Control": "public, max-age=900, s-maxage=1800" } });
