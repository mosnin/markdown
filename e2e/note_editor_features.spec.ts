import { test, expect } from "@playwright/test";

test.describe("Note editor", () => {
  test("/app/notes/[id] is gated behind authentication", async ({ page }) => {
    // The full CRDT note editor (src/components/product/note_crdt_editor.tsx)
    // is only mounted from the authenticated /app/notes/[note_id] route. With
    // no session, requireAuthenticatedUser() redirects to /sign_in. As a smoke
    // test we verify the route is reachable and that gating works.
    await page.goto(
      "/app/notes/00000000-0000-0000-0000-000000000000"
    );
    await expect(page).toHaveURL(/\/sign_in/);
    await expect(page.locator("body")).toBeVisible();
  });

  test("/share/note/[token] returns 404 for an invalid token", async ({
    page,
  }) => {
    // The public share route renders a read-only view of a shared note, not
    // the editor itself. Verifying that an invalid token 404s exercises the
    // public-facing surface without needing auth or real share state.
    const response = await page.goto("/share/note/not-a-real-token");
    expect(response?.status()).toBe(404);
  });

  test.skip("editor toolbar exposes formatting controls", async ({ page }) => {
    // TODO: This requires (a) an authenticated session and (b) seeding a real
    // note for the test workspace. Once both are in place, navigate to
    // /app/notes/<seeded-note-id> and assert that the toolbar buttons (bold,
    // italic, headings, lists, code, etc.) are visible and respond to clicks.
    await page.goto("/app/notes/seeded-note-id");
    await expect(
      page.getByRole("button", { name: /bold/i })
    ).toBeVisible();
  });
});
