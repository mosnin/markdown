import { test, expect } from "@playwright/test";

test.describe("OAuth authorization server metadata", () => {
  test("returns valid JSON from /.well-known/oauth-authorization-server", async ({
    request,
  }) => {
    const response = await request.get(
      "/.well-known/oauth-authorization-server"
    );
    expect(response.status()).toBe(200);

    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");

    const body = await response.json();
    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
    // RFC 8414 requires an issuer field
    expect(body).toHaveProperty("issuer");
  });
});
