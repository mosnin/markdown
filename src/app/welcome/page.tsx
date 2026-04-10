"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BoxLoader } from "@/components/ui/box-loader";

/**
 * Post-login welcome screen.
 *
 * Shown once after a user signs in or signs up. Plays the 3-second
 * box-stacking animation on a white background, then navigates to /app.
 * The animation's CSS duration is 3s; we wait 3.2s before redirecting
 * so the final frame is visible before the transition.
 */
export default function WelcomePage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace("/app");
    }, 3200);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <BoxLoader />
    </div>
  );
}
