import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Database,
  Key,
  ShieldCheck,
  Cpu,
  Layers,
  Lock,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";

export const metadata: Metadata = {
  title: "API & MCP — Poggle",
  description:
    "Programmatic access for your tools and agents. The REST API is the canonical interface; MCP lets AI agents use it natively.",
};

export default function ApiPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="API & MCP"
        title="Programmatic access for your tools and agents."
        description="The REST API is the canonical way to read and write. MCP is an adapter that lets AI agents use the same API natively."
        ctaPrimary={{ label: "Get API access", href: "/sign_in" }}
      />

      {/* REST API section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            REST API
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Database className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Full CRUD</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Create, read, update, and search notes, files, and context bundles programmatically.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Key className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Connection tokens</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Scoped API tokens with box-level access control and permission modes.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Write proposals</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              External agents propose changes. Humans approve or reject. No unsupervised edits.
            </p>
          </div>
        </div>
      </section>

      {/* MCP section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            MCP
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Cpu className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Model Context Protocol</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              AI agents discover and use your tools natively through the MCP standard.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Layers className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Same API, different interface</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              MCP is an adapter over the canonical API — not a second backend.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Scoped access</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Each MCP connection gets the same box-level permissions as API tokens.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border/50 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Ready to integrate?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Get your API token and start building. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Link
              href="/sign_in"
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
            >
              Get API access
              <ArrowRight className="h-4 w-4" />
            </Link>
            <ul className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
              {[
                "Free plan forever",
                "Import from Obsidian",
                "No vendor lock-in",
              ].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-violet-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
