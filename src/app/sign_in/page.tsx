import { redirect } from "next/navigation";
import { getRequestContext } from "@/server/auth/get_request_context";
import { AuthPanel } from "./sign_in_form";
import Link from "next/link";
import { Check } from "lucide-react";
import { PoggleMark } from "@/components/marketing/poggle_mark";

/**
 * Inverted variant for the dark left panel — wordmark in white, the
 * symbol still brand-yellow so the mark stays recognisable across the
 * brand/mono boundary.
 */
function PoggleMarkInverted() {
  return (
    <span className="inline-flex items-center gap-2 leading-none">
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border border-[oklch(0.78_0.18_88)] bg-brand text-brand-foreground"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-[58%] w-[58%]"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" opacity="0.45" />
          <rect x="7" y="7" width="14" height="14" rx="2.5" fill="currentColor" opacity="0.95" />
        </svg>
      </span>
      <span className="text-base font-semibold tracking-tight text-background [font-feature-settings:'cv11','ss01','ss03']">
        Poggle
      </span>
    </span>
  );
}

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

  const headline = defaultMode === "signup" ? "Create your account" : "Welcome back";
  const subtitle =
    defaultMode === "signup"
      ? "Start organizing knowledge for the AI era."
      : "Sign in to continue to your workspace.";

  return (
    <div className="flex min-h-screen">
      {/* ── Left panel: branding ─────────────────────────────────────────── */}
      <aside
        className="relative hidden flex-col justify-between bg-foreground p-10 lg:flex lg:w-1/2"
        style={{
          backgroundImage:
            "radial-gradient(900px 600px at 12% 14%, color-mix(in oklch, var(--brand) 7%, transparent), transparent 60%)",
        }}
      >
        {/* Brand mark — uses the canonical PoggleMark in `mono` surface
            so the wordmark sits white on near-black left panel. */}
        <Link href="/" className="relative inline-flex">
          <PoggleMarkInverted />
        </Link>

        {/* Center content */}
        <div className="relative max-w-md space-y-8">
          <div>
            <p className="text-overline text-background/60">
              Your second brain for AI
            </p>
            <h2 className="mt-3 text-[2rem] font-semibold leading-[1.1] tracking-tight text-background">
              Organize knowledge.
              <br />
              Package perfect context.
              <br />
              Never lose a decision.
            </h2>
          </div>
          <ul className="space-y-3.5">
            {FEATURES.map((f) => (
              <li
                key={f}
                className="flex items-center gap-3 text-[13px] leading-relaxed text-background/70"
              >
                <span
                  aria-hidden="true"
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ring-1 ring-background/20"
                >
                  <Check className="h-3 w-3 text-brand" strokeWidth={2.5} />
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom quote */}
        <blockquote className="relative max-w-md space-y-2">
          <p className="text-[13px] leading-relaxed text-background/60">
            &ldquo;Poggle changed how I work with AI. Every conversation
            starts with the right knowledge, not a blank slate.&rdquo;
          </p>
          <footer className="text-xs text-background/40">
            — Early beta user
          </footer>
        </blockquote>
      </aside>

      {/* ── Right panel: form ────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm space-y-7">
          {/* Mobile logo */}
          <div className="flex justify-center lg:hidden">
            <Link href="/" aria-label="Poggle home">
              <PoggleMark size="md" />
            </Link>
          </div>

          {/* Heading */}
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {headline}
            </h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>

          {/* Callback error */}
          {callbackError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
            >
              The confirmation link was invalid or has expired. Please try again.
            </div>
          )}

          {/* Auth form (login / signup toggle) */}
          <AuthPanel defaultMode={defaultMode} />

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            By continuing, you agree to our{" "}
            <Link
              href="/terms"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Terms of Service
            </Link>
            ,{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Privacy Policy
            </Link>
            ,{" "}
            <Link
              href="/acceptable-use"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Acceptable Use Policy
            </Link>
            , and{" "}
            <Link
              href="/cookies"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Cookie Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
