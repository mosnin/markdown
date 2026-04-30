import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Custom 404 page.
 *
 * Rendered when Next.js calls `notFound()` or a route doesn't match.
 * Keeps the user oriented with a clear message and a path back to the app.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-12 text-center">
      {/* Brand mark */}
      <Link href="/" className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="block h-5 w-5 rounded-[3px] bg-brand"
        />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Poggle
        </span>
      </Link>

      <div className="max-w-md space-y-3">
        <h1
          className="text-display text-muted-foreground/40"
          aria-label="404"
        >
          404
        </h1>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Page not found
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This page doesn&apos;t exist or you may not have access to it.
        </p>
      </div>

      <Button render={<a href="/app" />}>Go home</Button>
    </div>
  );
}
