"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Pro plan CTA for the marketing site.
 *
 * Invokes the real checkout flow: POST /api/billing/checkout returns a
 * { checkoutUrl } which we navigate to. The endpoint requires an authenticated
 * session — if the user is not signed in (401), we send them to /sign_in so
 * they can authenticate and start checkout from there.
 *
 * This wires the EXISTING billing flow (see src/app/api/billing/checkout/route.ts
 * and src/app/app/settings/settings_client.tsx) — it does not introduce any new
 * billing logic.
 */
export function UpgradeButton({
  children,
  className,
  variant = "default",
  showArrow = false,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  showArrow?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });

      // Not signed in (or no workspace yet) — route to sign in to authenticate,
      // then they can upgrade from settings.
      if (res.status === 401) {
        router.push("/sign_in");
        return;
      }

      const json = (await res.json()) as { checkoutUrl?: string };
      if (res.ok && json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
        return;
      }

      // Any other failure — fall back to sign in rather than dead-ending.
      router.push("/sign_in");
    } catch {
      router.push("/sign_in");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant={variant}
      className={cn("w-full font-semibold", className)}
      disabled={pending}
      onClick={handleClick}
    >
      {children}
      {showArrow && (
        <ArrowRightIcon className="size-4 ml-2" data-icon="inline-end" />
      )}
    </Button>
  );
}
