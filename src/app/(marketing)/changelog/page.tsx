import type { Metadata } from "next";
import { Calendar } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import {
  Card,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Changelog — Poggle",
  description:
    "What's new in each Poggle release. Follow along as we ship new features and improvements.",
};

const entries = [
  {
    date: "April 2026",
    description:
      "Skills and agents now support multi-file package structure with nested folders.",
  },
  {
    date: "April 2026",
    description: "Interactive graph view powered by xyflow with dagre layout.",
  },
  {
    date: "April 2026",
    description:
      "Sidebar tree rebuilt with react-arborist — drag, drop, and inline rename.",
  },
  {
    date: "March 2026",
    description: "Files, skills, and agents added as first-class object types.",
  },
  {
    date: "March 2026",
    description: "Full version history and lifecycle controls for all objects.",
  },
];

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Changelog"
        title="What's new in Poggle"
        description="Follow along as we ship new features and improvements."
      />

      <section className="mx-auto w-full max-w-3xl px-6 py-20">
        <div className="space-y-4">
          {entries.map((entry, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="mb-1 flex items-center gap-2 text-overline text-muted-foreground/70">
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                  {entry.date}
                </div>
                <CardDescription className="text-sm leading-relaxed text-foreground">
                  {entry.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
