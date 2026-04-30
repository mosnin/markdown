import type { Metadata } from "next";
import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Archive,
  BookOpen,
  Network,
  FolderTree,
  GripVertical,
  RefreshCw,
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
  title: "Collections & Folders — Poggle",
  description:
    "Organize your work into focused containers. Collections are top-level workspaces, folders give you real structural depth.",
};

type Feature = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
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

const COLLECTIONS: Feature[] = [
  {
    icon: Archive,
    title: "Focused collections",
    description:
      "Each collection is a self-contained context domain with its own notes, files, skills, and agents.",
  },
  {
    icon: BookOpen,
    title: "Guide notes",
    description:
      "Every collection can have a guide note — the first thing AI reads to understand the domain.",
  },
  {
    icon: Network,
    title: "Tree and graph views",
    description:
      "Navigate your collection contents as an interactive tree or explore relationships in the graph.",
  },
];

const FOLDERS: Feature[] = [
  {
    icon: FolderTree,
    title: "Real structural depth",
    description:
      "Nest folders as deep as you need. Folders are first-class objects, not just names.",
  },
  {
    icon: GripVertical,
    title: "Drag and drop",
    description:
      "Move items between folders by dragging them in the sidebar tree.",
  },
  {
    icon: RefreshCw,
    title: "Full lifecycle",
    description:
      "Archive or trash entire folder subtrees. Restore them when you need them.",
  },
];

export default function OrganizationPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Organization"
        title="Organize your work into focused containers."
        description="Collections are your top-level workspaces — one per project, topic, or domain. Folders give you real structural depth inside each collection."
        ctaPrimary={{ label: "Start organizing", href: "/sign_in" }}
      />

      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <SectionHeading>Collections</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {COLLECTIONS.map((f) => (
            <FeatureCard
              key={f.title}
              icon={f.icon}
              title={f.title}
              description={f.description}
            />
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <SectionHeading>Folders</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FOLDERS.map((f) => (
            <FeatureCard
              key={f.title}
              icon={f.icon}
              title={f.title}
              description={f.description}
            />
          ))}
        </div>
      </section>

      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-headline text-foreground">
            Ready to organize your knowledge?
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Create your first collection in seconds. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Start organizing
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
