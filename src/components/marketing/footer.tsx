import Link from "next/link";

const LINKS = {
  Product: [
    { href: "/features", label: "Features" },
    { href: "/pricing", label: "Pricing" },
    { href: "/about", label: "About" },
  ],
  Developers: [
    { href: "/docs", label: "Documentation" },
    { href: "/api", label: "API Reference" },
    { href: "/changelog", label: "Changelog" },
  ],
  Company: [
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
  ],
  Legal: [
    { href: "/privacy", label: "Privacy" },
    { href: "/terms", label: "Terms" },
  ],
};

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/50 bg-background">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 md:grid-cols-5">
          {/* Brand column */}
          <div className="col-span-2 sm:col-span-3 md:col-span-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600">
                <div className="h-2.5 w-2.5 rounded-sm bg-white" />
              </div>
              <span className="text-sm font-semibold tracking-tight">Poggle</span>
            </div>
            <p className="mt-4 max-w-[200px] text-xs leading-relaxed text-muted-foreground">
              A markdown-native context operating system for humans and AI.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(LINKS).map(([group, links]) => (
            <div key={group}>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
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

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border/50 pt-8 sm:flex-row sm:items-center">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Poggle. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground">
            Built for knowledge workers and AI-native teams.
          </p>
        </div>
      </div>
    </footer>
  );
}
