import { redirect } from "next/navigation";
import { getRequestContext } from "@/server/auth/get_request_context";
import { WelcomeOnboardingFlow } from "@/components/product/welcome_onboarding_flow";

export default async function WelcomePage() {
  const ctx = await getRequestContext();

  if (!ctx.isAuthenticated || !ctx.user) {
    redirect("/sign_in");
  }

  if (ctx.user.user_metadata?.onboarding_v1_complete) {
    redirect("/app");
  }

  const initialTheme =
    ctx.user.user_metadata?.theme === "dark" ? "dark" : "light";
  const initialFullName =
    (ctx.user.user_metadata?.full_name as string | undefined) ??
    (ctx.user.user_metadata?.name as string | undefined) ??
    "";

  return (
    <WelcomeOnboardingFlow
      initialTheme={initialTheme}
      initialFullName={initialFullName}
    />
  );
}
