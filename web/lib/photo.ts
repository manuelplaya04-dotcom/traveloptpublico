// Fotos de alojamiento servidas por el proxy propio (app/api/photo): mismos hosts que PHOTO_HOSTS en el motor.
const HOSTS = new Set(["lh3.googleusercontent.com", "lh4.googleusercontent.com", "lh5.googleusercontent.com",
  "lh6.googleusercontent.com"]);

// URL de la foto si es de un host permitido (https, sin credenciales ni puerto); si no, null.
export function photoTarget(raw: string | null | undefined): URL | null {
  if (!raw || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  return u.protocol === "https:" && HOSTS.has(u.hostname) && !u.username && !u.password && !u.port ? u : null;
}

// src para <img>: siempre el proxy propio, nunca el host de terceros (la IP de quien navega no sale del sitio).
export const photoSrc = (raw: string | null | undefined) =>
  photoTarget(raw) ? `/api/photo?u=${encodeURIComponent(raw!)}` : null;
