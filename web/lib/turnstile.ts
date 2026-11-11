// Cloudflare Turnstile: token de un solo uso que Supabase Auth verifica en el alta anónima (anti-bots, OWASP API6).
// El widget no se ve salvo que Cloudflare pida interacción.

// Clave de prueba pública de Cloudflare (siempre aprueba, invisible). Solo en desarrollo, pareada con el secreto de
// prueba de supabase/config.toml. En producción la clave real es obligatoria: sin ella Supabase rechaza el alta.
const DEV_TEST_SITE_KEY = "1x00000000000000000000BB";
const SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || (process.env.NODE_ENV !== "production" ? DEV_TEST_SITE_KEY : undefined);
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type RenderOptions = {
  sitekey: string;
  appearance: "always" | "execute" | "interaction-only";
  callback: (token: string) => void;
  "error-callback": () => void;
  "timeout-callback": () => void;
};
type Turnstile = { render(el: HTMLElement, opts: RenderOptions): string; remove(id: string): void };

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;

function load(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("captcha_unavailable")));
    s.onerror = () => {
      loading = null; // permite reintentar si falló la red
      reject(new Error("captcha_unavailable"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

const CAPTCHA_TIMEOUT_MS = 90_000; // tiempo para resolver un desafío interactivo; después se avisa en vez de quedar colgado

export const CAPTCHA_ERROR = "No pudimos verificar que sos una persona. Recargá la página e intentá de nuevo.";

export async function captchaToken(siteKey = SITE_KEY): Promise<string | undefined> {
  if (!siteKey) return undefined;
  const turnstile = await load();
  const box = document.createElement("div");
  box.className = "fixed bottom-4 left-1/2 z-50 -translate-x-1/2";
  box.dataset.testid = "captcha";
  // Dentro del <dialog> modal abierto si lo hay: fuera de él el navegador deja todo inerte y por debajo, y un desafío
  // interactivo (modo Managed) no se podría ver ni tocar.
  (document.querySelector("dialog[open]") ?? document.body).appendChild(box);
  let id: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const fail = () => reject(new Error("captcha_failed"));
      timer = setTimeout(() => reject(new Error("captcha_timeout")), CAPTCHA_TIMEOUT_MS);
      id = turnstile.render(box, {
        sitekey: siteKey,
        appearance: "interaction-only",
        callback: resolve,
        "error-callback": fail,
        "timeout-callback": fail,
      });
    });
  } finally {
    clearTimeout(timer);
    if (id) turnstile.remove(id);
    box.remove();
  }
}
