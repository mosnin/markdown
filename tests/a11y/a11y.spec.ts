import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  seedMockedAuthCookies,
  shouldSkipAuthRoutes,
} from "../visual/auth.fixture";
import { visualRoutes } from "../visual/routes";

/**
 * Accessibility suite.
 *
 * For each route in the shared `visualRoutes` list, run axe-core and
 * assert zero serious or critical violations. This complements the
 * Lighthouse a11y category (which scores aggregate severity) by
 * surfacing the specific rules and selectors a developer needs to fix.
 *
 * Auth handling matches `visual.spec.ts`: we seed the same mocked
 * Supabase cookie, and `SKIP_AUTH_VR=1` skips authenticated routes.
 */

const SEVERITY = ["serious", "critical"] as const;
type Severity = (typeof SEVERITY)[number];

for (const route of visualRoutes) {
  test(`a11y: ${route.id}`, async ({ browser, baseURL }) => {
    if (route.requiresAuth && shouldSkipAuthRoutes()) {
      test.skip(true, "SKIP_AUTH_VR=1 set; skipping authenticated route");
    }

    const context = await browser.newContext();

    try {
      if (route.requiresAuth) {
        await seedMockedAuthCookies(
          context,
          baseURL ?? "http://localhost:3000",
        );
      }

      const page = await context.newPage();
      await page.goto(route.path, { waitUntil: "networkidle" });

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const blocking = results.violations.filter((v) =>
        SEVERITY.includes(v.impact as Severity),
      );

      if (blocking.length > 0) {
        // Surface the offending rules + selectors in the failure log.
        const summary = blocking
          .map(
            (v) =>
              `[${v.impact}] ${v.id} — ${v.help}\n  ${v.nodes
                .map((n) => n.target.join(" "))
                .join("\n  ")}`,
          )
          .join("\n\n");
        // eslint-disable-next-line no-console
        console.error(`a11y violations for ${route.path}:\n${summary}`);
      }

      expect(blocking, "no serious or critical a11y violations").toEqual([]);
    } finally {
      await context.close();
    }
  });
}
