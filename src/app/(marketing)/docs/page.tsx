import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Boxes, FileText, GitBranch, ShieldCheck } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Docs — Poggle",
  description:
    "Documentation hub for Poggle: product concepts, API + MCP references, governance, and support resources.",
};

const DOC_SECTIONS = [
  {
    title: "Getting started",
    href: "/how-it-works",
    description: "Learn the core model — boxes, folders, notes, files, skills, and agents.",
    icon: BookOpen,
  },
  {
    title: "Organization model",
    href: "/organization",
    description: "Understand structure, lifecycle states, and how teams scale context safely.",
    icon: Boxes,
  },
  {
    title: "Connections & graph",
    href: "/connections",
    description: "Link context semantically and navigate relationships with confidence.",
    icon: GitBranch,
  },
  {
    title: "API & MCP",
    href: "/api",
    description: "Build integrations with the canonical API and MCP adapter surfaces.",
    icon: FileText,
  },
  {
    title: "Trust & governance",
    href: "/privacy",
    description: "Review privacy, security, and policy foundations for production use.",
    icon: ShieldCheck,
  },
] as const;

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Documentation"
        title="Everything you need to build with Poggle."
        description="Explore product guides, API references, MCP integration notes, and policy docs in one place."
        ctaPrimary={{ label: "Open API docs", href: "/api" }}
        ctaSecondary={{ label: "Visit Help Center", href: "/help" }}
      />

      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Browse by topic</h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {DOC_SECTIONS.map(({ title, href, description, icon: Icon }) => (
            <Link
              key={title}
              href={href}
              className="group rounded-xl border border-border/50 bg-card p-6 transition hover:border-violet-400/40 hover:shadow-sm"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
              <div className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-violet-400">
                Open section
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-border/50 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Need implementation help?</h2>
          <p className="mt-3 text-muted-foreground">
            If you&apos;re integrating OAuth, API writes, or MCP connectors, our team can help you unblock quickly.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <Button variant="outline" render={<Link href="/help" />}>Go to Help Center</Button>
            <Button render={<Link href="mailto:support@poggle.app" />}>Contact support</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
