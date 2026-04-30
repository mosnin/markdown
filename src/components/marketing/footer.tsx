import Link from "next/link";

const LINKS = {
  Product: [
    { href: "/features", label: "Features" },
    { href: "/notes-and-files", label: "Notes & Files" },
    { href: "/skills-and-agents", label: "Skills & Agents" },
    { href: "/connections", label: "Connections" },
    { href: "/pricing", label: "Pricing" },
  ],
  Company: [
    { href: "/about", label: "About" },
    { href: "/how-it-works", label: "How It Works" },
    { href: "/blog", label: "Blog" },
    { href: "/changelog", label: "Changelog" },
  ],
  Resources: [
    { href: "https://docs.poggle.app", label: "Documentation" },
    { href: "/api", label: "API & MCP" },
    { href: "/portability", label: "Import & Export" },
    { href: "/help", label: "Help Center" },
  ],
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
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 md:grid-cols-5">
          {/* Brand column */}
          <div className="col-span-2 sm:col-span-3 md:col-span-1">
            <Link
              href="/"
              className="inline-flex items-center gap-2"
              aria-label="Poggle home"
            >
              <span
                aria-hidden
                className="inline-block size-4 rounded-[3px] bg-brand"
              />
              <span className="text-[15px] font-semibold tracking-tight text-foreground">
                Poggle
              </span>
            </Link>
            <p className="mt-4 max-w-[220px] text-sm leading-relaxed text-muted-foreground">
              A markdown-native context operating system for humans and AI.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(LINKS).map(([group, links]) => (
            <div key={group}>
              <p className="mb-4 text-overline text-muted-foreground/70">
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

        {/* Small print row */}
        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-border pt-8 sm:flex-row sm:items-center">
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
