// Cookies de la sesión anónima: SOLO de sesión del navegador (Ley 25.326, minimización). @supabase/ssr fuerza
// maxAge = 400 días e ignora `cookieOptions`, así que la expiración se quita al escribir: sin Max-Age ni Expires la
// cookie desaparece al cerrar el navegador. Los borrados (maxAge 0) se respetan. En HTTPS se marcan `Secure`.
type CookieOptions = { maxAge?: number; expires?: Date; secure?: boolean; [k: string]: unknown };

export function sessionOnly<T extends CookieOptions>(options: T | undefined, https: boolean): T {
  const o = { ...(options ?? {}) } as T;
  if (o.maxAge === 0) return o; // borrado de cookie: hay que mantenerlo
  delete o.maxAge;
  delete o.expires;
  if (https) o.secure = true;
  return o;
}
