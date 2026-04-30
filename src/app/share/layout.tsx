import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top bar — brand mark + Sign in CTA */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="block h-5 w-5 rounded-[3px] bg-brand"
            />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Poggle
            </span>
          </Link>
          <Button size="sm" variant="outline" render={<a href="/sign_in" />}>
            Sign in
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
