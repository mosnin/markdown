import { describe, expect, it } from "vitest";
import { getPostAuthRedirectPath } from "@/server/auth/post_auth_redirect";

describe("getPostAuthRedirectPath", () => {
  it("routes unauthenticated/null user to welcome", () => {
    expect(getPostAuthRedirectPath(null)).toBe("/welcome");
  });

  it("routes users without onboarding metadata to welcome", () => {
    expect(getPostAuthRedirectPath({ user_metadata: {} })).toBe("/welcome");
  });

  it("routes users with onboarding complete metadata to app", () => {
    expect(
      getPostAuthRedirectPath({ user_metadata: { onboarding_v1_complete: true } }),
    ).toBe("/app");
  });
});
