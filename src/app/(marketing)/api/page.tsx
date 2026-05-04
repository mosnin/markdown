import type { Metadata } from "next";
import type { ComponentType, SVGProps } from "react";
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
  Link2,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "API & MCP — Poggle",
  description:
    "Programmatic access for your tools and agents. The REST API is the canonical interface; MCP lets AI agents use it natively.",
};

type Feature = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
};

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
          <Icon className="h-4.5 w-4.5 text-muted-foreground" />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <div className="mb-8">
      <h2 className="text-headline text-foreground">{children}</h2>
      <div className="mt-2 h-0.5 w-12 rounded-full bg-brand" />
    </div>
  );
}

const REST: Feature[] = [
  {
    icon: Database,
    title: "Full CRUD",
    description:
      "Create, read, update, and search notes, files, and context bundles programmatically.",
  },
  {
    icon: Key,
    title: "Connection tokens",
    description:
      "Scoped API tokens with box-level access control and permission modes.",
  },
  {
    icon: ShieldCheck,
    title: "Write proposals",
    description:
      "External agents propose changes. Humans approve or reject. No unsupervised edits.",
  },
];

const MCP: Feature[] = [
  {
    icon: Cpu,
    title: "Model Context Protocol",
    description:
      "AI agents discover and use your tools natively through the MCP standard.",
  },
  {
    icon: Layers,
    title: "Same API, different interface",
    description:
      "MCP is an adapter over the canonical API — not a second backend.",
  },
  {
    icon: Lock,
    title: "Scoped access",
    description:
      "Each MCP connection gets the same box-level permissions as API tokens.",
  },
];

export default function ApiPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="API & MCP"
        title="Programmatic access for your tools and agents."
        description="The REST API is the canonical way to read and write. MCP is an adapter that lets AI agents use the same API natively."
        ctaPrimary={{ label: "Get API access", href: "/sign_in" }}
      />

      {/* Pull links — for one-off context handoff */}
      <section className="mx-auto w-full max-w-5xl px-6 pt-20">
        <SectionHeading>Pull links — for one-off context handoff</SectionHeading>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[auto_1fr] lg:items-start">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
            <Link2 className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="max-w-2xl space-y-3 text-base leading-relaxed text-muted-foreground">
            <p>
              Not every model speaks MCP, and not every task is worth a full
              integration. A pull link is a short, expiring URL that any AI
              tool can fetch — paste it into Claude Web, ChatGPT, Gemini, or
              the bash tool inside Claude Code, and the model reads the file
              itself.
            </p>
            <p>
              Tokens are hashed at rest, scoped to a single object, capped at
              24 hours, and revocable instantly. Edits, when enabled, queue as
              proposals for human approval — not direct writes.
            </p>
            <p>
              <Link href="/help/send-to-ai" className="brand-underline">
                Walk through Send to AI →
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* REST API section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <SectionHeading>REST API</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {REST.map((f) => (
            <FeatureCard
              key={f.title}
              icon={f.icon}
              title={f.title}
              description={f.description}
            />
          ))}
        </div>
      </section>

      {/* MCP section */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <SectionHeading>MCP</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MCP.map((f) => (
            <FeatureCard
              key={f.title}
              icon={f.icon}
              title={f.title}
              description={f.description}
            />
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-headline text-foreground">Ready to integrate?</h2>
          <p className="mt-3 text-base text-muted-foreground">
            Get your API token and start building. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Get API access
              <ArrowRight className="h-4 w-4" />
            </Button>
            <ul className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
              {[
                "Free plan forever",
                "Import from Obsidian",
                "No vendor lock-in",
              ].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-brand" />
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
