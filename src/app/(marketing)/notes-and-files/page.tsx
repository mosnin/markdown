import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileText,
  Eye,
  History,
  Code,
  FileCode,
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
  title: "Notes & Files — Poggle",
  description:
    "Markdown notes and code artifacts in one place. Write notes for humans, manage files for machines — all with full version history.",
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

const NOTES: Feature[] = [
  {
    icon: FileText,
    title: "Markdown native",
    description:
      "Every note is plain markdown. No proprietary formats, no lock-in.",
  },
  {
    icon: Eye,
    title: "Document preview",
    description:
      "Notes render with readable formatting — headings, lists, code blocks, and more.",
  },
  {
    icon: History,
    title: "Version history",
    description:
      "Every save creates a version. Roll back to any point with one click.",
  },
];

const FILES: Feature[] = [
  {
    icon: FileCode,
    title: "Code artifacts",
    description:
      "JSON, YAML, Python, TypeScript, SQL, shell scripts — any format you need.",
  },
  {
    icon: Code,
    title: "Source editing",
    description: "Files open in a real code editor, not a rich text pretender.",
  },
  {
    icon: RefreshCw,
    title: "Full lifecycle",
    description:
      "Draft, active, archived, or trashed. Every file has a clear status.",
  },
];

export default function NotesAndFilesPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Notes & Files"
        title="Write notes. Manage code. All in one place."
        description="Notes are markdown documents for humans. Files are code artifacts for machines. Both live side by side in your workspace with full version history."
        ctaPrimary={{ label: "Get started free", href: "/sign_in" }}
      />

      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <SectionHeading>Notes</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {NOTES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <SectionHeading>Files</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FILES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </section>

      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-headline text-foreground">
            Ready to start writing?
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Create notes and files in seconds. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Get started free
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
