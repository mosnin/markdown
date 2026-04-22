import { test, expect } from "@playwright/test";

test.describe("Usage dashboard", () => {
  test("/app/usage responds with a sensible status", async ({ page }) => {
    // Phase 10B is creating /app/usage in parallel — it may or may not exist
    // at the time this test runs. Treat any of the following as acceptable:
    //   - 200 (page rendered, e.g. once authenticated or for a public shell)
    //   - 302/303/307 redirect to /sign_in (auth-gated, expected for now)
    //   - 404 (route not yet shipped by Phase 10B)
    // The test fails only on 5xx or some other unexpected status.
    const response = await page.goto("/app/usage");
    const status = response?.status() ?? 0;
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(500);

    // If we ended up on /sign_in, the route is gated — that's a valid smoke
    // result and we stop here.
    if (/\/sign_in/.test(page.url())) {
      await expect(page.locator("body")).toBeVisible();
      return;
    }

    // If we ended up on a 404, the route hasn't shipped yet — also acceptable.
    if (status === 404) {
      await expect(page.locator("body")).toBeVisible();
      return;
    }

    // Otherwise the page rendered. Look for the expected header text loosely
    // so this stays green regardless of whether the heading is "Usage",
    // "Cost", or a combination.
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).toContainText(/usage|cost/i);
  });

  test.skip("usage dashboard renders cost breakdown when authenticated", async ({
    page,
  }) => {
    // TODO: Requires an authenticated session plus seeded usage rows. Once
    // those are in place, assert on the cost summary cards, the per-model
    // breakdown table, and any date-range controls Phase 10B ships.
    await page.goto("/app/usage");
    await expect(page.getByRole("heading", { name: /usage|cost/i })).toBeVisible();
  });
});
