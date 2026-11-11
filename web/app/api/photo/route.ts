// Proxy de fotos de alojamiento: el navegador pide /api/photo?u=… y nunca le habla a Google directo (la IP de quien
// navega no sale del sitio y la CSP sigue con img-src 'self'). No es un proxy abierto: solo los hosts de miniaturas de
// Google (mismos que PHOTO_HOSTS en el modelo del motor), https, sin redirecciones, tipo imagen y tamaño acotado.
import { photoTarget } from "@/lib/photo";

const MAX_BYTES = 2_000_000;

export async function GET(req: Request) {
  const target = photoTarget(new URL(req.url).searchParams.get("u"));
  if (!target) return new Response("invalid_photo", { status: 400 });
  let upstream: Response;
  try {
    upstream = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(8_000) });
  } catch {
    return new Response("photo_unavailable", { status: 502 });
  }
  const type = upstream.headers.get("content-type") ?? "";
  const size = Number(upstream.headers.get("content-length") ?? "0");
  if (!upstream.ok || !/^image\/(jpeg|png|webp|avif)$/.test(type) || size > MAX_BYTES) {
    return new Response("photo_unavailable", { status: 502 });
  }
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("photo_unavailable", { status: 502 });
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
