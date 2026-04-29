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

export const metadata: Metadata = {
  title: "Skills & Agents — Poggle",
  description:
    "Build reusable modules and structured orchestrators. Skills are lighter building blocks, agents are heavier orchestrators — both with real package structure.",
};

export default function SkillsAndAgentsPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Skills & Agents"
        title="Build reusable modules and structured orchestrators."
        description="Skills are lighter reusable building blocks. Agents are heavier structured orchestrators. Both support multiple files, nested folders, and real package structure."
        ctaPrimary={{ label: "Start building", href: "/sign_in" }}
      />

      {/* Skills section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Skills
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FileCode className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">One source, many files</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Each skill has one canonical source file plus as many supporting files and folders as you need.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Share2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Workspace reusable</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Share skills across multiple boxes by attaching them as references — not copies.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <PackageOpen className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Read-only exports</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Export skills as portable packages that preserve structure and metadata.
            </p>
          </div>
        </div>
      </section>

      {/* Agents section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Agents
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Cpu className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Structured orchestrators</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Agents have a type, model hint, system prompt, and full child file structure.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Link2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Skill references</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Agents can reference skills as dependencies — explicit, not inferred.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <PanelTop className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Multi-tab workspace</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Overview, source, files, skills, relationships, and trust — all in one place.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border/50 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Ready to build smarter?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Create your first skill or agent in minutes. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>Start building
              <ArrowRight className="h-4 w-4" /></Button>
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
