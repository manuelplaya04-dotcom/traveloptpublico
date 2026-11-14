import { NextResponse } from "next/server";
import { engineFetch } from "@/lib/engine";
import { engineFxSchema, type FxRates } from "@/lib/fx";

// GET /api/fx -> dólar tarjeta y MEP para mostrar precios en pesos. La cotización la trae el motor y la cachea en la
// base (30 min, compartida por todas las instancias); acá solo hay una copia en memoria de 10 min para no llamar al
// motor en cada página. El navegador nunca habla con el motor ni con dolarapi.com.
const TTL_MS = 10 * 60 * 1000;
const ENGINE_TIMEOUT_MS = 4_000; // norma 4: API no crítica, más de 4 s y se sigue sin ella
let cached: { at: number; rates: FxRates } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) return ok(cached.rates);
  try {
    const r = await engineFetch("/v1/fx/ars", { signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS) });
    const parsed = r.ok ? engineFxSchema.safeParse(await r.json()) : null;
    if (!parsed?.success) throw new Error("cotización no disponible");
    cached = { at: Date.now(), rates: parsed.data };
    return ok(parsed.data);
  } catch {
    // Degradación elegante: la copia anterior marcada como vieja; si no hay, la web muestra USD con un aviso.
    return cached
      ? ok({ ...cached.rates, stale: true })
      : NextResponse.json({ code: "fx_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

const ok = (rates: FxRates) =>
  NextResponse.json(rates, { headers: { "Cache-Control": "public, max-age=600, s-maxage=600" } });
