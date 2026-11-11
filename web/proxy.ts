// Next.js 16: "proxy.ts" (en Next <= 15 este archivo se llama middleware.ts y exporta `middleware`).
// 1) CSP con nonce por request: sin 'unsafe-inline' en scripts. Next lee el nonce del header CSP del request y lo
//    aplica a sus scripts; 'strict-dynamic' habilita lo que esos scripts cargan (p. ej. Turnstile).
// 2) Refresca la sesión anónima de Supabase, con cookies solo de sesión (lib/supabase/cookies.ts).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sessionOnly } from "@/lib/supabase/cookies";

const dev = process.env.NODE_ENV !== "production";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const turnstile = "https://challenges.cloudflare.com";

export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    // 'nonce' + 'strict-dynamic' en navegadores modernos; 'self' y el host de Turnstile solo como respaldo de los viejos
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${turnstile}${dev ? " 'unsafe-eval'" : ""}`,
    `frame-src ${turnstile}`,
    "style-src 'self' 'unsafe-inline'", // estilos: Leaflet y React escriben atributos style (no ejecutan código)
    "img-src 'self' data: blob:", // los tiles del mapa pasan por /api/tiles
    "font-src 'self'",
    `connect-src 'self' ${supabaseUrl} ${supabaseUrl.replace(/^http/, "ws")}${dev ? " ws://localhost:*" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  // 128 bits aleatorios por request (CSPRNG), en base64
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  let response = next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = next();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, sessionOnly(options, !dev)));
        },
      },
    },
  );
  await supabase.auth.getUser();
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [{
    source: "/((?!_next/static|_next/image|favicon.ico|api/tiles).*)", // los tiles no usan sesión ni HTML
    missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }],
  }],
};
