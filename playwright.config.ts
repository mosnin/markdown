import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration.
 *
 * Tests live in two roots:
 *   - `e2e/`   — existing functional E2E tests
 *   - `tests/` — visual-regression and a11y suites added in Move 5
 *
 * The `webServer` block boots `pnpm dev` against stub Supabase/app URL
 * env vars so visual + a11y suites can run without secrets against the
 * marketing routes. CI exports the same stub envs from the build job
 * (see `.github/workflows/ci.yml`).
 */

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/**/*.spec.ts", "tests/**/*.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: BASE_URL,
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          NEXT_PUBLIC_SUPABASE_URL:
            process.env.NEXT_PUBLIC_SUPABASE_URL ??
            "https://placeholder.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder_anon_key",
          SUPABASE_SERVICE_ROLE_KEY:
            process.env.SUPABASE_SERVICE_ROLE_KEY ??
            "placeholder_service_role_key",
          NEXT_PUBLIC_APP_URL:
            process.env.NEXT_PUBLIC_APP_URL ??
            "https://placeholder.example.com",
        },
      },
});
