import { test, expect } from "@playwright/test";
import {
  seedMockedAuthCookies,
  shouldSkipAuthRoutes,
} from "./auth.fixture";
import { viewports, visualRoutes, type ViewportName } from "./routes";

/**
 * Visual-regression suite.
 *
 * For each route in `visualRoutes` we capture a full-page screenshot at
 * desktop (1280×800) and mobile (375×812). Baselines live under
 * `tests/visual/__screenshots__/` and are committed.
 *
 * Update locally with:
 *   pnpm test:visual:update
 *
 * Auth: routes flagged `requiresAuth` use `seedMockedAuthCookies` to
 * inject a placeholder Supabase session cookie before the first request.
 * If `SKIP_AUTH_VR=1` we skip those routes so the suite still runs
 * partially without secrets (marketing + sign-in baseline).
 */

const viewportNames = Object.keys(viewports) as ViewportName[];

for (const route of visualRoutes) {
  test.describe(`visual: ${route.id}`, () => {
    for (const viewportName of viewportNames) {
      test(`${route.id} @ ${viewportName}`, async ({ browser, baseURL }) => {
        if (route.requiresAuth && shouldSkipAuthRoutes()) {
          test.skip(true, "SKIP_AUTH_VR=1 set; skipping authenticated route");
        }

        const context = await browser.newContext({
          viewport: viewports[viewportName],
        });

        try {
          if (route.requiresAuth) {
            await seedMockedAuthCookies(
              context,
              baseURL ?? "http://localhost:3000",
            );
          }

          const page = await context.newPage();
          const response = await page.goto(route.path, {
            waitUntil: "networkidle",
          });

          // Marketing + sign-in must respond 2xx; auth routes may redirect
          // through the auth gate when the placeholder session is rejected.
          // We still capture the resulting page for baseline tracking.
          if (!route.requiresAuth) {
            expect(response?.status()).toBeLessThan(400);
          }

          // Disable animations + caret blink to keep diffs deterministic.
          await page.addStyleTag({
            content: `
              *, *::before, *::after {
                animation-duration: 0s !important;
                animation-delay: 0s !important;
                transition-duration: 0s !important;
                transition-delay: 0s !important;
                caret-color: transparent !important;
              }
            `,
          });

          await expect(page).toHaveScreenshot(
            `${route.id}.${viewportName}.png`,
            {
              fullPage: true,
              maxDiffPixelRatio: 0.01,
              animations: "disabled",
              caret: "hide",
            },
          );
        } finally {
          await context.close();
        }
      });
    }
  });
}
