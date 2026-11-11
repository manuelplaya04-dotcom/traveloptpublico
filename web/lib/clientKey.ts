import { createHmac } from "node:crypto";

// Clave seudónima de la conexión para el límite de búsquedas por IP: HMAC-SHA256(IP, secreto del servidor), primeros
// 128 bits en hex. La IP nunca sale de esta función: el motor solo ve la clave y sin el secreto no puede volver atrás
// (Ley 25.326: minimización).
//
// Solo se confía en la IP que pone Vercel (`x-real-ip`, que el borde de Vercel sobrescribe). Fuera de Vercel esos
// headers los puede inventar el cliente, así que no hay clave y rige el límite por sesión y el global.
export function clientKey(headers: Headers, secret: string | undefined, onVercel = Boolean(process.env.VERCEL)): string | null {
  if (!onVercel || !secret) return null;
  const ip = headers.get("x-real-ip")?.trim();
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F.:]+$/.test(ip)) return null;
  return createHmac("sha256", secret).update(`travelopt:client:${ip}`).digest("hex").slice(0, 32);
}
