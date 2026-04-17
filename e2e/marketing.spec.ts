import { test, expect } from "@playwright/test";

test.describe("Marketing pages", () => {
  test("homepage loads and has a title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/.+/);
  });

  test("pricing page loads", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.locator("body")).toBeVisible();
  });

  test("about page loads", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("body")).toBeVisible();
  });
});
