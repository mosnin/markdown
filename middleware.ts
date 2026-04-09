import { type NextRequest } from "next/server";
import { refreshSession } from "@/lib/supabase/proxy";

/**
 * Next.js middleware — session proxy layer.
 *
 * Runs on every non-static request and delegates to `refreshSession`,
 * which refreshes Supabase auth cookies silently. No route protection
 * logic lives here — authorization is enforced in server components
 * via `requireAuthenticatedUser()`.
 *
 * The instructions refer to this as "proxy.ts". Next.js requires the
 * file to be named `middleware.ts`; the proxy logic is in
 * `src/lib/supabase/proxy.ts`.
 */
export async function middleware(request: NextRequest) {
  return refreshSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on all paths except:
     * - _next/static  (Next.js static assets)
     * - _next/image   (image optimisation)
     * - favicon.ico
     * - common static asset extensions
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
