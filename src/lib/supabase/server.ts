import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client.
 *
 * Use in Server Components, Server Actions, and Route Handlers.
 * Reads and writes auth cookies via next/headers so the session
 * is available across server renders.
 *
 * Must be called inside an async function — `cookies()` requires
 * the request context to be active.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll is called from Server Components where cookies are
            // read-only. The middleware handles the actual cookie refresh,
            // so this is safe to ignore here.
          }
        },
      },
    }
  );
}
