// Proxy de tiles de OpenStreetMap con caché de CDN: el hero y el mapa piden acá en vez de al servidor público de OSM,
// cuya política de uso no admite tráfico alto ni clientes sin identificar. Host fijo (sin SSRF) y coordenadas
// validadas; la respuesta queda cacheada 7 días en el CDN.
const MAX_ZOOM = 18;
const UPSTREAM = "https://tile.openstreetmap.org";
const USER_AGENT = "TravelOpt/1.0 (+https://travelopt-rho.vercel.app)";

const toInt = (s: string) => (/^\d{1,6}$/.test(s) ? Number(s) : NaN);

export async function GET(_req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const p = await params;
  const [z, x, y] = [toInt(p.z), toInt(p.x), toInt(p.y)];
  const n = 2 ** z;
  if (!(z >= 0 && z <= MAX_ZOOM && x >= 0 && x < n && y >= 0 && y < n)) {
    return new Response("invalid_tile", { status: 400 });
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/${z}/${x}/${y}.png`, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return new Response("tile_unavailable", { status: 502 });
  }
  if (!upstream.ok || !upstream.headers.get("content-type")?.startsWith("image/")) {
    return new Response("tile_unavailable", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
}
