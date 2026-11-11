import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// La CSP (con nonce por request, sin unsafe-inline en scripts) la arma proxy.ts: acá van las demás cabeceras.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  // Aislamiento: otra pestaña abierta desde un sitio ajeno no obtiene referencia a esta ventana, y otros sitios no
  // pueden incrustar nuestras respuestas (fotos, tiles, JSON) como recursos propios.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Sin cacheComponents/PPR: la CSP con nonce exige render por request (el shell estático no puede llevar el nonce).
  // Decisión 9 de project_guidelines.md.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
