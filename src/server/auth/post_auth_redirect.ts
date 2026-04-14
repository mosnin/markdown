import { type User } from "@supabase/supabase-js";

/**
 * Computes where an authenticated user should land after auth.
 * Users who have not completed onboarding are sent to `/welcome`.
 */
export function getPostAuthRedirectPath(user: Pick<User, "user_metadata"> | null): "/welcome" | "/app" {
  if (!user) return "/welcome";
  return user.user_metadata?.onboarding_v1_complete ? "/app" : "/welcome";
}
