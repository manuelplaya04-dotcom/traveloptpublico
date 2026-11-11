import "server-only";

// Única puerta del frontend hacia el motor. ENGINE_API_KEY jamás llega al navegador.
export async function engineFetch(path: string, init: RequestInit = {}) {
  const base = process.env.ENGINE_BASE_URL;
  const key = process.env.ENGINE_API_KEY;
  if (!base || !key) throw new Error("ENGINE_BASE_URL / ENGINE_API_KEY no configuradas");
  // La API key viaja en cada request: fuera de localhost solo por https.
  const { protocol, hostname } = new URL(base);
  if (protocol !== "https:" && !["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("ENGINE_BASE_URL debe ser https fuera de localhost");
  }
  return fetch(`${base}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
  });
}
