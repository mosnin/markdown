import { test, expect } from "@playwright/test";

test.describe("Workflows pages", () => {
  test("/app/workflows redirects unauthenticated users to /sign_in", async ({
    page,
  }) => {
    // The workflows page is gated by requireAuthenticatedUser(), which calls
    // redirect("/sign_in") when there is no session. As a smoke test, we just
    // verify the route exists and the redirect lands on the sign-in page.
    await page.goto("/app/workflows");
    await expect(page).toHaveURL(/\/sign_in/);
    await expect(page.locator("body")).toBeVisible();
  });

  test("/app/workflows/[id]/edit redirects unauthenticated users", async ({
    page,
  }) => {
    // Edit pages also gate on auth before they can hit notFound() for an
    // unknown workflow id, so we expect the same redirect behaviour for an
    // unauthenticated visitor and a non-existent workflow id.
    await page.goto(
      "/app/workflows/00000000-0000-0000-0000-000000000000/edit"
    );
    await expect(page).toHaveURL(/\/sign_in/);
    await expect(page.locator("body")).toBeVisible();
  });

  test.skip("renders the Workflows page header when authenticated", async ({
    page,
  }) => {
    // TODO: Wire up an authenticated browser context (via storage state or a
    // test-only sign-in helper) before enabling this. Once authenticated, the
    // page should render the "Workflows" header and either the empty state
    // ("No workflows yet") or a list of workflow rows.
    await page.goto("/app/workflows");
    await expect(
      page.getByRole("heading", { name: "Workflows" })
    ).toBeVisible();
    const emptyState = page.getByText("No workflows yet");
    const list = page.locator("ul li");
    await expect(emptyState.or(list.first())).toBeVisible();
  });

  test.skip("non-existent workflow id 404s gracefully when authenticated", async ({
    page,
  }) => {
    // TODO: Requires an authenticated session. With auth wired up, hitting
    // /app/workflows/<unknown-uuid>/edit should render the Next.js not-found
    // page instead of redirecting to sign-in.
    const response = await page.goto(
      "/app/workflows/00000000-0000-0000-0000-000000000000/edit"
    );
    expect(response?.status()).toBe(404);
  });
});
