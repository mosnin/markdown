import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileCode,
  Share2,
  PackageOpen,
  Cpu,
  Link2,
  PanelTop,
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
  title: "Skills & Agents — Poggle",
  description:
    "Build reusable modules and structured orchestrators. Skills are lighter building blocks, agents are heavier orchestrators — both with real package structure.",
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

const SKILLS: Feature[] = [
  {
    icon: FileCode,
    title: "One source, many files",
    description:
      "Each skill has one canonical source file plus as many supporting files and folders as you need.",
  },
  {
    icon: Share2,
    title: "Workspace reusable",
    description:
      "Share skills across multiple boxes by attaching them as references — not copies.",
  },
  {
    icon: PackageOpen,
    title: "Read-only exports",
    description:
      "Export skills as portable packages that preserve structure and metadata.",
  },
];

const AGENTS: Feature[] = [
  {
    icon: Cpu,
    title: "Structured orchestrators",
    description:
      "Agents have a type, model hint, system prompt, and full child file structure.",
  },
  {
    icon: Link2,
    title: "Skill references",
    description:
      "Agents can reference skills as dependencies — explicit, not inferred.",
  },
  {
    icon: PanelTop,
    title: "Multi-tab workspace",
    description:
      "Overview, source, files, skills, relationships, and trust — all in one place.",
  },
];

export default function SkillsAndAgentsPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Skills & Agents"
        title="Build reusable modules and structured orchestrators."
        description="Skills are lighter reusable building blocks. Agents are heavier structured orchestrators. Both support multiple files, nested folders, and real package structure."
        ctaPrimary={{ label: "Start building", href: "/sign_in" }}
      />

      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <SectionHeading>Skills</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SKILLS.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <SectionHeading>Agents</SectionHeading>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </section>

      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-headline text-foreground">
            Ready to build smarter?
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Create your first skill or agent in minutes. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Start building
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
