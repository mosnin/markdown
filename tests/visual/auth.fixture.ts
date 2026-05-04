import { test as base, type BrowserContext } from "@playwright/test";

/**
 * Mocked-auth fixture.
 *
 * Visual-regression and a11y suites need to render authenticated pages
 * (`/app`, `/app/admin/performance`) without contacting real Supabase.
 * This fixture seeds a stub Supabase auth-token cookie that downstream
 * server components read via `@supabase/ssr`.
 *
 * The cookie payload mirrors the shape Supabase's JS client writes — a
 * JSON-encoded session object with `access_token` and `refresh_token` —
 * but the values are placeholders. This works for visual baselines
 * because the build-time stub `NEXT_PUBLIC_SUPABASE_*` env vars cause
 * the server client to accept the placeholder session and the
 * downstream RPCs are mocked or short-circuited.
 *
 * If `SKIP_AUTH_VR=1` is set, suites that consume `authenticatedContext`
 * call `test.skip()` early so the run still completes against the
 * marketing-only routes.
 */

export interface AuthenticatedSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
}

export const stubSession: AuthenticatedSession = {
  accessToken: "vr-mock-access-token",
  refreshToken: "vr-mock-refresh-token",
  userId: "00000000-0000-0000-0000-00000000beef",
  email: "vr-bot@example.com",
};

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";

/** Derive the cookie name `@supabase/ssr` uses for a project ref. */
function cookieNameForSupabaseUrl(url: string): string {
  try {
    const host = new URL(url).host;
    const ref = host.split(".")[0] ?? "placeholder";
    return `sb-${ref}-auth-token`;
  } catch {
    return "sb-placeholder-auth-token";
  }
}

export async function seedMockedAuthCookies(
  context: BrowserContext,
  baseUrl: string,
): Promise<void> {
  const url = new URL(baseUrl);
  const name = cookieNameForSupabaseUrl(SUPABASE_URL);
  const value = JSON.stringify({
    access_token: stubSession.accessToken,
    refresh_token: stubSession.refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: stubSession.userId,
      email: stubSession.email,
    },
  });

  await context.addCookies([
    {
      name,
      value: encodeURIComponent(value),
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: url.protocol === "https:",
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
    },
  ]);
}

export const shouldSkipAuthRoutes = (): boolean =>
  process.env.SKIP_AUTH_VR === "1";

interface AuthFixtures {
  authenticatedContext: BrowserContext;
}

export const test = base.extend<AuthFixtures>({
  authenticatedContext: async ({ browser, baseURL }, use) => {
    const url = baseURL ?? "http://localhost:3000";
    const context = await browser.newContext();
    await seedMockedAuthCookies(context, url);
    await use(context);
    await context.close();
  },
});

export { expect } from "@playwright/test";
