"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Post-login welcome screen.
 *
 * Shown once after a user signs in or signs up. Auto-advances to /app after
 * a brief moment so the user perceives a confident handoff. The redesign
 * drops the box-stacking ornament for a quiet, dignified hero card with a
 * single primary action and a subtle auto-redirect cue.
 */
export default function WelcomePage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace("/app");
    }, 2400);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md space-y-8 text-center">
        {/* Brand mark */}
        <div className="flex justify-center">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="block h-5 w-5 rounded-[3px] bg-brand"
            />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Poggle
            </span>
          </Link>
        </div>

        <div className="space-y-3">
          <p className="text-overline text-muted-foreground">
            You&apos;re in
          </p>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground">
            Welcome to Poggle
          </h1>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            Setting up your workspace. You&apos;ll be redirected in a moment.
          </p>
        </div>

        <div className="flex justify-center">
          <Button render={<a href="/app" />}>
            Continue to your workspace
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
