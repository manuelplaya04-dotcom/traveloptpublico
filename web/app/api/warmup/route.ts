import { NextResponse, connection } from "next/server";
import { engineFetch } from "@/lib/engine";

// En el plan gratuito el motor se duerme tras 15 min sin uso. El onboarding llama a esta ruta al abrirse para que el
// motor arranque mientras la persona completa el formulario. No devuelve datos y la CDN la cachea 60 s, así que no
// sirve para amplificar tráfico hacia el motor.
export const maxDuration = 60;

export async function GET() {
  await connection(); // siempre en tiempo de pedido, nunca en el build
  const awake = await engineFetch("/healthz").then((r) => r.ok, () => false);
  return NextResponse.json(
    { awake },
    { headers: awake ? { "Cache-Control": "public, s-maxage=60" } : { "Cache-Control": "no-store" } },
  );
}
