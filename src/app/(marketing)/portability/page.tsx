import type { Metadata } from "next";
import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileDown,
  FolderOpen,
  AlertTriangle,
  Archive,
  FolderDown,
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
  title: "Import & Export — Poggle",
  description:
    "Portable packages you own forever. Import from Obsidian or any markdown source. Export any box, folder, or note as a structured zip.",
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

const IMPORT: Feature[] = [
  {
    icon: FileDown,
    title: "Markdown import",
    description:
      "Drop in a zip of markdown files. Poggle creates notes, folders, and links automatically.",
  },
  {
    icon: FolderOpen,
    title: "Obsidian compatible",
    description: "Import your Obsidian vault with structure preserved.",
  },
  {
    icon: AlertTriangle,
    title: "Collision handling",
    description:
      "Skip, rename, or overwrite when imported content overlaps with existing.",
  },
];

const EXPORT: Feature[] = [
  {
    icon: Archive,
    title: "Box export",
    description:
      "Download an entire box as a zip with all notes, folders, links, and a manifest.",
  },
  {
    icon: FolderDown,
    title: "Folder export",
    description:
      "Export just one folder and its descendants — scoped and clean.",
  },
  {
    icon: Link2,
    title: "Signed downloads",
    description:
      "Export links are signed and valid for one hour. No permanent storage URLs.",
  },
];

export default function PortabilityPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Import & Export"
        title="Portable packages you own forever."
        description="Import from Obsidian or any markdown source. Export any box, folder, or note as a structured zip with manifest and full history."
        ctaPrimary={{ label: "Start importing", href: "/sign_in" }}
      />

      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <SectionHeading>Import</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {IMPORT.map((f) => (
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
        <SectionHeading>Export</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {EXPORT.map((f) => (
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
            Ready to take control of your data?
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Import your existing notes in minutes. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Start importing
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
