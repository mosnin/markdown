import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Public landing / entry point.
 * Redirects to /app once auth is implemented.
 * For now: minimal holding page with a clear entry point.
 */
export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Logo mark */}
        <div className="flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground">
            <div className="h-5 w-5 rounded-sm bg-background" />
          </div>
        </div>

        {/* Identity */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Context Store
          </h1>
          <p className="text-sm text-muted-foreground">
            A structured, markdown-native context operating system
            for humans and AI.
          </p>
        </div>

        {/* Entry point — Link styled as button (Base UI Button doesn't support asChild) */}
        <div className="flex flex-col gap-2">
          <Link
            href="/app"
            className={cn(buttonVariants(), "gap-2 justify-center")}
          >
            Open app
            <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="text-xs text-muted-foreground">
            Auth is not yet implemented. This goes directly to the app shell.
          </p>
        </div>
      </div>
    </div>
  );
}
