import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Custom 404 page.
 *
 * Rendered when Next.js calls `notFound()` or a route doesn't match.
 * Keeps the user oriented with a clear message and a path back to the app.
 */
export default function NotFound() {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
      </div>

      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Page not found
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This page doesn&apos;t exist or you may not have access to it.
        </p>
      </div>

      <Button asChild size="sm">
        <Link href="/app">Go to dashboard</Link>
      </Button>
    </div>
  );
}
