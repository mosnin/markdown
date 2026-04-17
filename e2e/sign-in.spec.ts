import { test, expect } from "@playwright/test";

test.describe("Sign-in page", () => {
  test("renders the sign-in page", async ({ page }) => {
    await page.goto("/sign_in");
    await expect(page.locator("body")).toBeVisible();
    // The page should contain a form or sign-in related content
    await expect(page.locator("body")).toContainText(/sign in|log in|email/i);
  });
});
