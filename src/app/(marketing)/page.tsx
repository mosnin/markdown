import { connection } from "next/server";
import Link from "next/link";
import {
  CheckCircle2,
  Check,
  Users,
  Briefcase,
  Building2,
  FileText,
  FolderTree,
  Package,
} from "lucide-react";
import { HeroSection } from "@/components/marketing/hero";
import * as PricingCard from "@/components/ui/pricing-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

// ─── Shared ───────────────────────────────────────────────────────────────────

function Bullet({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex gap-3">
      <Check
        className="mt-0.5 h-4 w-4 shrink-0 text-brand"
        aria-hidden="true"
      />
      <p className="text-[15px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{title}.</span> {children}
      </p>
    </div>
  );
}

// ─── Illustrative cards (replace fake macOS terminals) ────────────────────────

function FileRow({
  icon: Icon,
  label,
  meta,
  active = false,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  meta?: string;
  active?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm " +
        (active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60")
      }
    >
      <Icon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden={true}
      />
      <span className={active ? "font-medium" : ""}>{label}</span>
      {meta && (
        <span className="ml-auto text-[11px] text-muted-foreground/70">
          {meta}
        </span>
      )}
    </div>
  );
}

function OrganizeCard() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <p className="text-overline text-muted-foreground/70">Box</p>
        <CardTitle>Architecture</CardTitle>
        <CardDescription>5 files · 2 folders · updated 2m ago</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pb-4">
        <FileRow icon={FileText} label="system_design.md" meta="2.1 KB" active />
        <FileRow icon={FileText} label="api_contracts.md" meta="1.4 KB" />
        <FileRow icon={FileText} label="data_flow.md" meta="0.9 KB" />
        <FileRow icon={FolderTree} label="decisions/" meta="3 items" />
        <FileRow icon={FolderTree} label="references/" meta="1 item" />
      </CardContent>
    </Card>
  );
}

function BundleCard() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <p className="text-overline text-muted-foreground/70">Skill package</p>
        <CardTitle>refactoring</CardTitle>
        <CardDescription>
          One canonical source · supporting files · referenced by 3 boxes
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pb-4">
        <FileRow icon={Package} label="skill.md" meta="source" active />
        <FileRow icon={FileText} label="patterns.md" />
        <FileRow icon={FileText} label="examples.md" />
        <FileRow icon={FolderTree} label="cases/" meta="4 files" />
      </CardContent>
    </Card>
  );
}

function HistoryCard() {
  const rows = [
    { v: "v4", label: "Current", time: "2 min ago", active: true },
    { v: "v3", label: "Added caching notes", time: "1 hr ago", active: false },
    { v: "v2", label: "Initial draft", time: "Yesterday", active: false },
    { v: "v1", label: "Created", time: "3 days ago", active: false },
  ] as const;
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <p className="text-overline text-muted-foreground/70">
          Version history
        </p>
        <CardTitle>system_design.md</CardTitle>
        <CardDescription>
          Every save is preserved · one-click rollback
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5 pb-4">
        {rows.map((row) => (
          <div
            key={row.v}
            className={
              "flex items-center gap-3 rounded-md px-2.5 py-1.5 text-sm " +
              (row.active
                ? "bg-accent text-foreground"
                : "text-muted-foreground")
            }
          >
            <span
              className={
                "w-7 text-[11px] font-medium " +
                (row.active ? "text-brand" : "text-muted-foreground/70")
              }
            >
              {row.v}
            </span>
            <span className={row.active ? "font-medium" : ""}>{row.label}</span>
            <span className="ml-auto text-[11px] text-muted-foreground/70">
              {row.time}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  await connection();
  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <HeroSection />

      {/* ── Organize ──────────────────────────────────────────────────────────── */}
      <section className="border-t border-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
            <div className="space-y-8">
              <div className="space-y-4">
                <p className="text-overline text-brand">Organize</p>
                <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                  Organize deliberately.
                </h2>
                <p className="text-base leading-relaxed text-muted-foreground">
                  Boxes are focused containers for your projects and topics.
                  Inside each box, use folders, notes, files, skills, and agents
                  — all navigable in an interactive tree with drag-and-drop.
                </p>
              </div>
              <div className="space-y-4">
                <Bullet title="Five object types">
                  Notes for documents, files for code, skills for reusable
                  modules, agents for orchestrators, and folders for structure.
                </Bullet>
                <Bullet title="Semantic links">
                  Connect any object to any other with ten typed relationship
                  types — not just backlinks.
                </Bullet>
                <Bullet title="Tree and graph views">
                  Navigate your workspace in the sidebar tree or explore the
                  full knowledge graph visually.
                </Bullet>
              </div>
            </div>
            <div className="flex justify-center lg:justify-end">
              <OrganizeCard />
            </div>
          </div>
        </div>
      </section>

      {/* ── Build ─────────────────────────────────────────────────────────────── */}
      <section className="border-t border-border bg-muted/30 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
            <div className="order-2 flex justify-center lg:order-1 lg:justify-start">
              <BundleCard />
            </div>
            <div className="order-1 space-y-8 lg:order-2">
              <div className="space-y-4">
                <p className="text-overline text-brand">Build</p>
                <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                  Build real structure.
                </h2>
                <p className="text-base leading-relaxed text-muted-foreground">
                  Skills and agents are more than single files. Each one has a
                  canonical source plus supporting files and nested folders —
                  real package structure, not flat blobs.
                </p>
              </div>
              <div className="space-y-4">
                <Bullet title="Skills">
                  Lighter reusable modules you can share across boxes. One
                  source file, many supporting files.
                </Bullet>
                <Bullet title="Agents">
                  Heavier orchestrators with type, model hint, system prompt,
                  and skill references.
                </Bullet>
                <Bullet title="Portable exports">
                  Export any box, folder, skill, or agent as a structured zip
                  with manifest and history.
                </Bullet>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── History ───────────────────────────────────────────────────────────── */}
      <section className="border-t border-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
            <div className="space-y-8">
              <div className="space-y-4">
                <p className="text-overline text-brand">History</p>
                <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                  Own your history.
                </h2>
                <p className="text-base leading-relaxed text-muted-foreground">
                  Every edit to every object is tracked. Notes, files, skills,
                  and agents all have full version history with one-click
                  rollback and an append-only audit log.
                </p>
              </div>
              <div className="space-y-4">
                <Bullet title="Version history">
                  Every save creates a version across all object types — not
                  just notes.
                </Bullet>
                <Bullet title="One-click rollback">
                  Restore any prior version of any object instantly.
                </Bullet>
                <Bullet title="Full audit log">
                  Every action is recorded — creates, edits, lifecycle changes,
                  and machine writes.
                </Bullet>
              </div>
            </div>
            <div className="flex justify-center lg:justify-end">
              <HistoryCard />
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────────── */}
      <section className="border-t border-border bg-muted/30 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 max-w-xl">
            <p className="text-overline text-brand mb-3">Pricing</p>
            <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Simple pricing.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Start free, upgrade when you&apos;re ready. No lock-in, no
              surprises.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 justify-items-center md:grid-cols-3">
            {[
              {
                icon: <Users />,
                name: "Free",
                price: "Free",
                period: null as string | null,
                annual: null as string | null,
                badge: null as string | null,
                description: "Start organizing your knowledge.",
                cta: "Get started free",
                href: "/sign_in",
                variant: "outline" as const,
                features: [
                  "100 notes & files",
                  "3 boxes",
                  "Skills & agents",
                  "7-day version history",
                ],
              },
              {
                icon: <Briefcase />,
                name: "Pro",
                price: "$12",
                period: "/month",
                annual: "$9",
                badge: "Popular",
                description: "For serious knowledge workers.",
                cta: "Start free trial",
                href: "/sign_in",
                variant: "default" as const,
                features: [
                  "Unlimited everything",
                  "Unlimited boxes",
                  "Full graph & tree views",
                  "Full version history",
                  "API & MCP access",
                ],
              },
              {
                icon: <Building2 />,
                name: "Team",
                price: "$39",
                period: "/month",
                annual: "$29",
                badge: null as string | null,
                description: "Shared context for collaborative teams.",
                cta: "Contact sales",
                href: "/contact",
                variant: "outline" as const,
                features: [
                  "Everything in Pro",
                  "Shared workspaces",
                  "Team audit log",
                  "SSO / SAML",
                  "Priority support",
                ],
              },
            ].map((plan) => (
              <PricingCard.Card
                key={plan.name}
                className="w-full md:min-w-[260px]"
              >
                <PricingCard.Header>
                  <PricingCard.Plan>
                    <PricingCard.PlanName>
                      {plan.icon}
                      {plan.name}
                    </PricingCard.PlanName>
                    {plan.badge && (
                      <PricingCard.Badge>{plan.badge}</PricingCard.Badge>
                    )}
                  </PricingCard.Plan>
                  <PricingCard.Price>
                    <PricingCard.MainPrice>{plan.price}</PricingCard.MainPrice>
                    {plan.period && (
                      <PricingCard.Period>{plan.period}</PricingCard.Period>
                    )}
                  </PricingCard.Price>
                  {plan.annual && (
                    <p className="mb-3 -mt-1 text-xs text-muted-foreground">
                      or {plan.annual}/mo billed annually
                    </p>
                  )}
                  <Button
                    variant={plan.variant}
                    className="w-full font-semibold"
                    render={<Link href={plan.href} />}
                  >
                    {plan.cta}
                  </Button>
                </PricingCard.Header>
                <PricingCard.Body>
                  <PricingCard.Description>
                    {plan.description}
                  </PricingCard.Description>
                  <PricingCard.List>
                    {plan.features.map((feature) => (
                      <PricingCard.ListItem key={feature}>
                        <CheckCircle2
                          className="size-4 shrink-0 text-brand"
                          aria-hidden="true"
                        />
                        <span>{feature}</span>
                      </PricingCard.ListItem>
                    ))}
                  </PricingCard.List>
                </PricingCard.Body>
              </PricingCard.Card>
            ))}
          </div>
          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              All plans include a 14-day free trial. No credit card required.
            </p>
            <Link
              href="/pricing"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Full pricing details →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────────── */}
      <section className="border-t border-border px-6 py-32 text-center">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            It&apos;s your time to focus.
          </h2>
          <p className="mt-6 text-lg text-muted-foreground">
            Free to start. Bring your notes, files, skills, and agents together
            in one place.
          </p>
          <div className="mt-10 flex justify-center">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Get Poggle
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

