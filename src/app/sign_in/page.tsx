import { redirect } from "next/navigation";
import { getRequestContext } from "@/server/auth/get_request_context";
import { AuthPanel } from "./sign_in_form";
import Link from "next/link";
import { Check } from "lucide-react";

export const metadata = {
  title: "Sign in — Poggle",
};

const FEATURES = [
  "Unlimited structured boxes",
  "AI-ready context bundles",
  "Full version history",
  "Plain markdown — always portable",
];

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
    <div className="flex min-h-screen">
      {/* ── Left panel: branding ─────────────────────────────────────────── */}
      <div className="relative hidden flex-col justify-between bg-[#0F1117] p-10 lg:flex lg:w-1/2">
        {/* Subtle glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-violet-600/15 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-violet-600/10 blur-3xl" />
        </div>

        {/* Logo */}
        <Link href="/" className="relative flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
            <div className="h-3 w-3 rounded-sm bg-white" />
          </div>
          <span className="text-sm font-semibold text-white">Poggle</span>
        </Link>

        {/* Center content */}
        <div className="relative space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">
              Your second brain for AI
            </p>
            <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-white">
              Organize knowledge.
              <br />
              Package perfect context.
              <br />
              Never lose a decision.
            </h2>
          </div>
          <ul className="space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-3 text-sm text-white/70">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20">
                  <Check className="h-3 w-3 text-violet-400" />
                </div>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom quote */}
        <blockquote className="relative space-y-2">
          <p className="text-sm italic leading-relaxed text-white/60">
            &ldquo;Poggle changed how I work with AI. Every conversation
            starts with the right knowledge, not a blank slate.&rdquo;
          </p>
          <footer className="text-xs text-white/40">
            — Early beta user
          </footer>
        </blockquote>
      </div>

      {/* ── Right panel: form ────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile logo */}
          <div className="flex justify-center lg:hidden">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
                <div className="h-3 w-3 rounded-sm bg-background" />
              </div>
              <span className="text-sm font-semibold text-foreground">Poggle</span>
            </Link>
          </div>

          {/* Heading */}
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Welcome back
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in or create your free account below.
            </p>
          </div>

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
  );
}
