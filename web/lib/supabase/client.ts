import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { sessionOnly } from "@/lib/supabase/cookies";
import { CAPTCHA_ERROR, captchaToken } from "@/lib/turnstile";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // Cookies propias para que sean de sesión (ver lib/supabase/cookies.ts).
      cookies: {
        getAll: () => parseCookieHeader(document.cookie ?? "").map(({ name, value }) => ({ name, value: value ?? "" })),
        setAll: (list) => list.forEach(({ name, value, options }) => {
          document.cookie = serializeCookieHeader(name, value, sessionOnly(options, location.protocol === "https:"));
        }),
      },
    },
  );
}

// Sesión anónima de Supabase: da un auth.uid() estable para RLS sin pedir registro. El alta exige CAPTCHA.
// Dura lo que dura la sesión del navegador: no hay que volver a resolver el CAPTCHA mientras se arma el viaje.
export async function ensureSession(supabase = createClient()) {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  const token = await captchaToken().catch(() => {
    throw new Error(CAPTCHA_ERROR);
  });
  const { data: anon, error } = await supabase.auth.signInAnonymously({ options: { captchaToken: token } });
  if (error) throw error.code === "captcha_failed" ? new Error(CAPTCHA_ERROR) : error;
  return anon.session;
}
