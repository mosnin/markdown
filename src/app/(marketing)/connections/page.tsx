import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  List,
  Unlink,
  MessageSquare,
  Move,
  Shapes,
  Eye,
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
  title: "Connections — Poggle",
  description:
    "Connect your knowledge with typed relationships. Every object can link to any other with explicit semantics, visible in an interactive graph.",
};

type Feature = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
};

function FeatureCard({ icon: Icon, title, description }: Feature) {
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

const SEMANTIC: Feature[] = [
  {
    icon: List,
    title: "Ten relationship types",
    description:
      "Related, depends on, extends, parent of, derived from — pick the one that fits.",
  },
  {
    icon: Unlink,
    title: "Cross-type linking",
    description:
      "Link notes to files, skills to agents, folders to anything. Not just note-to-note.",
  },
  {
    icon: MessageSquare,
    title: "Directed and annotated",
    description:
      "Every link has a direction and optional annotation for context.",
  },
];

const GRAPH: Feature[] = [
  {
    icon: Move,
    title: "Interactive visualization",
    description:
      "Pan, zoom, click, and explore your knowledge graph in real time.",
  },
  {
    icon: Shapes,
    title: "All object types",
    description:
      "Notes, files, skills, agents, and folders all appear as nodes with typed edges.",
  },
  {
    icon: Eye,
    title: "Read-only by design",
    description:
      "The graph is for understanding structure, not editing it — changes happen in the tree.",
  },
];

export default function ConnectionsPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Connections"
        title="Connect your knowledge with typed relationships."
        description="Every object in Poggle can link to any other with explicit semantic relationships. See the full picture in the interactive graph."
        ctaPrimary={{ label: "Start connecting", href: "/sign_in" }}
      />

      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <SectionHeading>Semantic links</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SEMANTIC.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <SectionHeading>Graph view</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {GRAPH.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </section>

      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-headline text-foreground">
            Ready to connect your knowledge?
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Build your first graph in minutes. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Start connecting
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
