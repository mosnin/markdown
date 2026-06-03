import Link from "next/link";
import Image from "next/image";

const LINKS = {
  Product: [
    { href: "/how-it-works", label: "How It Works" },
    { href: "/pricing", label: "Pricing" },
    { href: "/sign_in", label: "Sign In" },
  ],
  Developers: [
    { href: "https://docs.poggle.app", label: "Documentation" },
  ],
  // Legal pages are owned by another agent — keep every route reachable here.
  Legal: [
    { href: "/terms", label: "Terms of Service" },
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/cookies", label: "Cookie Policy" },
    { href: "/acceptable-use", label: "Acceptable Use" },
    { href: "/refund-policy", label: "Refund Policy" },
    { href: "/dmca", label: "DMCA" },
  ],
};

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/50 bg-background">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 md:grid-cols-4">
          {/* Brand column */}
          <div className="col-span-2 sm:col-span-3 md:col-span-1">
            <div className="flex items-center gap-2.5">
              <Image src="/logo-symbol-dark.png" alt="Poggle" width={28} height={28} className="rounded dark:hidden" />
              <Image src="/logo-symbol-light.png" alt="Poggle" width={28} height={28} className="rounded hidden dark:block" />
              <Image src="/logo-text-black.png" alt="Poggle" width={64} height={22} className="dark:hidden" />
              <Image src="/logo-text-white.png" alt="Poggle" width={64} height={22} className="hidden dark:block" />
            </div>
            <p className="mt-4 max-w-[220px] text-xs leading-relaxed text-muted-foreground">
              The governed context layer for AI agents. They propose, you approve.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(LINKS).map(([group, links]) => (
            <div key={group}>
              <p className="text-overline mb-3 text-muted-foreground/70">
                {group}
              </p>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border/50 pt-8 sm:flex-row sm:items-center">
          {/*
           * `new Date().getFullYear()` is hydration-safe here: this is a
           * server component (no "use client"), so it only runs on the
           * server. The rendered HTML ships to the client as static markup
           * and is never re-evaluated during hydration, so server/client
           * cannot disagree.
           */}
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Poggle. All rights reserved.
          </p>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {[
              { href: "/terms", label: "Terms" },
              { href: "/privacy", label: "Privacy" },
              { href: "/cookies", label: "Cookies" },
              { href: "/acceptable-use", label: "Acceptable Use" },
              { href: "/refund-policy", label: "Refunds" },
              { href: "/dmca", label: "DMCA" },
            ].map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="transition-colors hover:text-foreground"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
