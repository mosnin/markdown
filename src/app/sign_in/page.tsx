import { redirect } from "next/navigation";
import { getRequestContext } from "@/server/auth/get_request_context";
import { AuthPanel } from "./sign_in_form";
import { BrandPanel } from "./brand_panel";
import { BorderGlow } from "@/components/border-glow";
import Link from "next/link";

export const metadata = {
  title: "Sign in — Poggle",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mode?: string }>;
}) {
  const { isAuthenticated } = await getRequestContext();

  if (isAuthenticated) {
    redirect("/app");
  }

  const { error, mode } = await searchParams;
  const callbackError = error === "auth_callback_failed";
  const defaultMode = mode === "signup" ? "signup" : "signin";

  return (
    <BorderGlow
      colorPreset="royal"
      innerGlow
      animationDuration={9}
      glowIntensity={0.5}
      borderWidth="2em"
      blurAmount="2.75rem"
      className="min-h-screen rounded-none"
    >
    <div className="flex min-h-[calc(100svh-2rem)]">
      {/* ── Left panel: branding ─────────────────────────────────────────── */}
      <BrandPanel />

      {/* ── Right panel: form ────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-xs space-y-6">
          {/* Mobile logo */}
          <div className="flex justify-center lg:hidden">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
                <div className="h-3 w-3 rounded-sm bg-background" />
              </div>
              <span className="font-display text-sm font-semibold text-foreground">Poggle</span>
            </Link>
          </div>

          {/* Heading */}
          <div className="mb-6 text-center">
            <p className="font-hero text-2xl font-semibold tracking-tight text-foreground">
              Govern your AI agents.
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Agents propose changes; you approve every one.
            </p>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Sign in to continue.
          </p>

          {/* Callback error */}
          {callbackError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              The confirmation link was invalid or has expired. Please try again.
            </div>
          )}

          {/* Auth form (login / signup toggle) */}
          <AuthPanel defaultMode={defaultMode} />

          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            By signing in, you agree to our{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
              Terms of Service
            </Link>
            ,{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </Link>
            ,{" "}
            <Link href="/acceptable-use" className="underline underline-offset-2 hover:text-foreground">
              Acceptable Use Policy
            </Link>
            , and{" "}
            <Link href="/cookies" className="underline underline-offset-2 hover:text-foreground">
              Cookie Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
    </BorderGlow>
  );
}
