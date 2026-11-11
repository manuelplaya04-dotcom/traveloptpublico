import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { sessionOnly } from "@/lib/supabase/cookies";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, sessionOnly(options, process.env.NODE_ENV === "production")));
          } catch {
            // Llamado desde un Server Component: el refresco de sesión lo hace proxy.ts
          }
        },
      },
    },
  );
}
