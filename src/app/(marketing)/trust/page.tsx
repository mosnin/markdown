import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2,
  FileLock2,
  Fingerprint,
  GitBranch,
  History,
  KeyRound,
  Lock,
  Network,
  Scale,
  ShieldCheck,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeroSection } from "@/components/marketing/hero";

export const metadata: Metadata = {
  title: "Trust & Security — Poggle",
  description:
    "How Poggle handles your data, who can read what, and the controls available to you and your team.",
};

interface PillarProps {
  icon: React.ElementType;
  title: string;
  body: string;
  details: string[];
}

function Pillar({ icon: Icon, title, body, details }: PillarProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <Icon className="h-4 w-4" />
          </span>
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription className="mt-2">{body}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="list-none space-y-2">
          {details.map((d) => (
            <li
              key={d}
              className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"
            >
              <CheckCircle2
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand"
                aria-hidden="true"
              />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const PILLARS: PillarProps[] = [
  {
    icon: ShieldCheck,
    title: "Data isolation",
    body:
      "Every row is scoped to a workspace. Postgres row-level security policies enforce that scope at the database — not just at the application layer — so a bug in app code can't accidentally leak data across tenants.",
    details: [
      "Row-level security (RLS) on every table that holds tenant data",
      "Workspace boundary enforced in policies, services, and the audit log",
      "Per-request workspace context derived from the auth session, never the URL",
      "Admin-only operations re-verified server-side on every action",
    ],
  },
  {
    icon: Fingerprint,
    title: "Authentication",
    body:
      "Email + password is the floor, not the ceiling. Passkeys (WebAuthn) sign you in without ever sending a password to the wire, and OAuth 2.1 with PKCE is the default for any third-party app touching your workspace.",
    details: [
      "WebAuthn / FIDO2 passkeys for passwordless sign-in",
      "OAuth 2.1 with PKCE — no implicit flow, no client-secret-in-browser",
      "Custom-scope grants so apps see only what you let them see",
      "Refresh-token rotation; one-shot authorization codes; 1-hour access tokens",
    ],
  },
  {
    icon: KeyRound,
    title: "API & developer keys",
    body:
      "Issue narrow keys for narrow jobs. Every connection has a permission mode, every OAuth client has explicit scopes, and every key can be revoked instantly — no waiting for a token to expire.",
    details: [
      "Per-connection permission modes: read-only, write-with-approval, full",
      "Operator API keys are user-scoped and revocable from settings",
      "OAuth client secrets shown exactly once at registration",
      "Legacy csk_v1_ tokens have a guided migration path",
    ],
  },
  {
    icon: History,
    title: "Audit log",
    body:
      "Every meaningful change is recorded — note edits, lifecycle changes, AI-driven writes, exports. The log is append-only and visible to admins inside the product.",
    details: [
      "Append-only event stream for every workspace-level action",
      "Machine writes vs human writes are distinguished and traceable",
      "Bundle exports, branch promotions, and consent revocations all logged",
      "Per-event metadata captures actor, scope, and outcome",
    ],
  },
  {
    icon: GitBranch,
    title: "Branch-aware writes",
    body:
      "AI writes — and humans editing alongside an agent — land on a branch first. You review the diff, accept or veto, and only then does main change. Promotion gates can wire the decision through your CI.",
    details: [
      "Every AI proposal is a branch with full version history",
      "Optional webhook gates run before promotion, can veto",
      "Branch retention policy auto-warns and discards idle drafts",
      "Promoted-to-main history is immutable",
    ],
  },
  {
    icon: FileLock2,
    title: "Encryption & infrastructure",
    body:
      "Data is encrypted at rest in the database and in transit over TLS. Secrets live in environment-isolated stores; we never bake credentials into builds.",
    details: [
      "TLS 1.2+ on every public endpoint",
      "Database encryption at rest provided by Supabase / Postgres",
      "Object storage (attachments, exports) encrypted at rest",
      "Sentry client/edge/server captures errors with PII scrubbing",
    ],
  },
  {
    icon: Network,
    title: "Network & rate-limiting",
    body:
      "Public endpoints are rate-limited at the edge with Upstash; abuse and runaway loops can't take a workspace down. Webhooks and exports run as workers, off the request path.",
    details: [
      "Upstash Redis rate-limit on auth, OAuth, and write paths",
      "Cloudflare Workers handle bundle export + diff jobs",
      "Inngest schedules retries, retention sweeps, and embedding refreshes",
      "Webhook deliveries are signed and replay-safe",
    ],
  },
  {
    icon: Scale,
    title: "Portability & ownership",
    body:
      "If you ever leave, you leave with your data. Every box, folder, note, file, skill, and agent exports as plain markdown plus a JSON manifest — and import is the reverse, with full collision handling.",
    details: [
      "Workspace-level export / import (admin-only, downloadable as zip)",
      "Plain markdown bodies; YAML frontmatter for metadata",
      "Version history rides along in the manifest",
      "Cancel anytime; exports remain valid after cancellation",
    ],
  },
];

export default function TrustPage() {
  return (
    <main>
      <PageHeroSection
        eyebrow="Trust & Security"
        title="Built so it can be trusted with the work."
        description="Poggle stores your knowledge — and increasingly, your AI's. Here's how that data is protected, who can read what, and the controls available to you and your team."
      />

      <section className="border-t border-border bg-background px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <p className="text-overline text-brand">Eight pillars</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              The same plumbing your security team would build, already wired.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              Each pillar below is real — not aspirational. Click through to the
              feature pages or the docs to see the actual surfaces and APIs.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <Pillar key={p.title} {...p} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-muted/30 px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <p className="text-overline text-brand">Compliance roadmap</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Where we are, and what's next.
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              {
                title: "GDPR — Live",
                body:
                  "Data export and account deletion are first-class. EU customers can ask for a portable copy or full erasure at any time.",
                tone: "live",
              },
              {
                title: "CCPA — Live",
                body:
                  "California customers can request the same export and deletion controls.",
                tone: "live",
              },
              {
                title: "SOC 2 Type II — In progress",
                body:
                  "Pre-audit phase. Controls inventory, access reviews, and incident response are documented; an external auditor begins observation in the next quarter.",
                tone: "progress",
              },
              {
                title: "ISO 27001 — Planned",
                body:
                  "Scoped for the year following SOC 2 Type II. Customer-driven; happy to share the roadmap on request.",
                tone: "planned",
              },
              {
                title: "HIPAA — Planned (regulated tier)",
                body:
                  "Available as a separate enterprise tier when there's named demand. BAAs are not in scope on the standard plan.",
                tone: "planned",
              },
              {
                title: "EU data residency — Planned",
                body:
                  "Region pinning for EU customers via a dedicated database region. Contact us if this is a blocker today.",
                tone: "planned",
              },
            ].map((row) => (
              <div
                key={row.title}
                className="rounded-lg border border-border bg-card p-5"
              >
                <p className="text-sm font-semibold text-foreground">
                  {row.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {row.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-background px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <Lock
            className="mx-auto h-6 w-6 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Need a security review?
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            We send a SIG-Lite, our DPA, and the architecture diagrams on
            request. Most reviews close inside a week.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              variant="brand"
              render={<Link href="mailto:trust@poggle.app" />}
            >
              Email trust@poggle.app
            </Button>
            <Button
              size="lg"
              variant="ghost"
              render={<Link href="/privacy" />}
            >
              Read the privacy policy →
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
