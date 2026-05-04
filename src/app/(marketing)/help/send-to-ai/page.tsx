import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  History,
  KeyRound,
  Link2,
  ListChecks,
  ShieldCheck,
  Terminal,
  Workflow,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBashOneLiner } from "@/lib/send_to_ai_format";

export const metadata: Metadata = {
  title: "Send context to your AI — Poggle",
  description:
    "Bring your Poggle notes into Claude, Cursor, ChatGPT, or any AI tool in one paste. Three transports — MCP, pull links, and a bash one-liner — with audit and revoke baked in.",
};

// MCP_CONFIG_JSON, PULL_LINK_EXAMPLE, and TTL_PRESETS are documentation-
// specific to this walkthrough and intentionally stay inline. The bash
// one-liner reuses `formatBashOneLiner` from the popover's shared module
// (src/lib/send_to_ai_format.ts) so the example string can never drift
// from what the popover actually emits.
const MCP_CONFIG_JSON = `{
  "mcpServers": {
    "poggle": {
      "command": "npx",
      "args": ["-y", "@poggle/mcp@latest"],
      "env": {
        "POGGLE_TOKEN": "pgl_live_…"
      }
    }
  }
}`;

const PULL_LINK_EXAMPLE = "https://poggle.app/p/n/{token}.md";

const BASH_ONELINER = formatBashOneLiner(PULL_LINK_EXAMPLE);

// ─── Small primitives kept local to keep the page self-contained ─────────────

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-10 max-w-2xl">
      <p className="text-overline text-brand">{eyebrow}</p>
      <h2 className="mt-3 text-headline text-foreground">{title}</h2>
      <div className="mt-2 h-0.5 w-12 rounded-full bg-brand" />
      {description && (
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}

function TransportCard({
  id,
  icon: Icon,
  badge,
  title,
  why,
  when,
  children,
}: {
  id: string;
  icon: React.ElementType;
  badge?: string;
  title: string;
  why: string;
  when: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
            <Icon className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
          </div>
          {badge && (
            <span className="inline-flex items-center rounded-full border border-border-strong bg-muted/40 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {badge}
            </span>
          )}
        </div>
        <CardTitle className="mt-3">{title}</CardTitle>
        <CardDescription>{why}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-overline text-muted-foreground/70">When to pick it</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {when}
          </p>
        </div>
        <div className="border-t border-border" />
        <div>
          <p className="text-overline text-muted-foreground/70">How</p>
          <div className="mt-2">{children}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-[12.5px] leading-relaxed font-mono text-foreground/90">
      <code>{children}</code>
    </pre>
  );
}

function StepList({ items }: { items: string[] }) {
  return (
    <ol className="flex flex-col gap-2 pl-0 [counter-reset:step]">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold text-foreground"
          >
            {i + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
      <CheckCircle2
        className="mt-0.5 h-4 w-4 shrink-0 text-brand"
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}

// ─── TTL table data ──────────────────────────────────────────────────────────

type TTLRow = {
  preset: string;
  ttl: string;
  kind: "hard" | "sliding";
  best: string;
};

const TTL_PRESETS: TTLRow[] = [
  {
    preset: "15 min",
    ttl: "Hard",
    kind: "hard",
    best: "One-shot — “read this once.”",
  },
  {
    preset: "1 hour",
    ttl: "Hard",
    kind: "hard",
    best: "A single focused task.",
  },
  {
    preset: "Session",
    ttl: "Sliding 30 min, 24 h cap",
    kind: "sliding",
    best: "Active agent work that should die when idle.",
  },
  {
    preset: "4 hours",
    ttl: "Hard",
    kind: "hard",
    best: "Long task, no check-ins required.",
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SendToAiHelpPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Help → Send to AI"
        title={
          <>
            Bring your Poggle context
            <br />
            into any AI.
          </>
        }
        description="Stop pasting the same notes into every chat. Three transports cover everything from a one-off ChatGPT question to a full-time Claude Code session — with audit, expiry, and one-click revoke baked in."
        ctaPrimary={{ label: "Open Poggle", href: "/app" }}
        ctaSecondary={{ label: "Read the API docs", href: "/api" }}
      />

      {/* ── Three transports ─────────────────────────────────────────────── */}
      <section className="border-b border-border px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeading
            eyebrow="Three transports"
            title="Pick the one that matches your tool."
            description="Same data, three ways out. MCP for daily drivers, pull links for one-off chats, the terminal one-liner for engineers who never leave the shell."
          />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <TransportCard
              id="mcp"
              icon={Workflow}
              badge="Recommended"
              title="MCP — Claude Code & Cursor"
              why="Persistent connection, never expires, full read and write. The model discovers Poggle as a first-class tool and uses it natively."
              when="You use Claude Code or Cursor regularly and want Poggle available in every session without re-pasting anything."
            >
              <StepList
                items={[
                  "Copy the config block below.",
                  "Paste it into your client's MCP config file (Claude Code: ~/.claude/mcp.json, Cursor: Settings → MCP).",
                  "Restart the client. Poggle's tools appear in the tool list.",
                ]}
              />
              <div className="mt-4">
                <CodeBlock>{MCP_CONFIG_JSON}</CodeBlock>
                <p className="mt-2 text-xs text-muted-foreground/80">
                  Token from{" "}
                  <Link
                    href="/app/settings/connected_apps"
                    className="brand-underline text-muted-foreground hover:text-foreground"
                  >
                    Settings → Connected apps
                  </Link>
                  .
                </p>
              </div>
            </TransportCard>

            <TransportCard
              id="pull-link"
              icon={Link2}
              badge="Universal"
              title="Pull link — any chat tool"
              why="Zero setup. Works in Claude Web, ChatGPT, Gemini, or any model that can fetch a URL. One short line, one paste, the model reads the file itself."
              when="One-off task, a tool that doesn't speak MCP, or you just want to share context with a teammate's chat without giving them a token."
            >
              <StepList
                items={[
                  "Open any note in Poggle and click “Send to AI.”",
                  "Pick a TTL and copy the generated line.",
                  "Paste it into your chat. The model fetches it on the next turn.",
                ]}
              />
              <div className="mt-4">
                <CodeBlock>{PULL_LINK_EXAMPLE}</CodeBlock>
                {/* TODO: replace with animated screenshot — desired size 720x420 */}
              </div>
            </TransportCard>

            <TransportCard
              id="bash"
              icon={Terminal}
              badge="Terminal"
              title="Bash one-liner"
              why="Terminal-native. Pipes cleanly into the bash tool inside Claude Code, into a script, or into your own agent harness."
              when="You live in a terminal, or you're wiring Poggle context into CI, a Make target, or a cron job."
            >
              <StepList
                items={[
                  "Generate a pull link the same way as above.",
                  "Wrap it in curl and pipe to your tool of choice.",
                  "Cap the byte count if you're worried about model context windows.",
                ]}
              />
              <div className="mt-4">
                <CodeBlock>{BASH_ONELINER}</CodeBlock>
              </div>
            </TransportCard>
          </div>
        </div>
      </section>

      {/* ── Updates land as proposals ────────────────────────────────────── */}
      <section
        id="updates"
        className="scroll-mt-24 border-b border-border bg-muted/30 px-6 py-20"
      >
        <div className="mx-auto max-w-6xl">
          <SectionHeading
            eyebrow="Update path"
            title="Updates land as proposals."
            description="A pull link can be opened up to allow edits. They never write directly — every change queues for human approval."
          />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                  <ListChecks
                    className="h-4.5 w-4.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <CardTitle className="mt-3">How a write flows</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-2.5 text-sm leading-relaxed text-muted-foreground">
                  <li className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold text-foreground">
                      1
                    </span>
                    <span>
                      The AI POSTs an edit to your pull link (when edits are
                      enabled).
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold text-foreground">
                      2
                    </span>
                    <span>
                      Poggle queues the change as a proposal — the note
                      itself is untouched.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold text-foreground">
                      3
                    </span>
                    <span>
                      Approve or reject from the{" "}
                      <span className="font-medium text-foreground">
                        AI Edits
                      </span>{" "}
                      sidebar item. Approved proposals merge with full diff
                      history.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold text-foreground">
                      4
                    </span>
                    <span>
                      The AI sees the updated state on its next pull — same
                      URL, fresh contents.
                    </span>
                  </li>
                </ol>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                  <History
                    className="h-4.5 w-4.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <CardTitle className="mt-3">What gets recorded</CardTitle>
                <CardDescription>
                  Every read and every write hits the audit log — token
                  fingerprint, user-agent, IP, byte count, and the resulting
                  proposal id.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 list-none">
                  <Bullet>
                    Read-only by default. “Allow edits” must be
                    explicitly toggled on per token.
                  </Bullet>
                  <Bullet>
                    Approved proposals appear as a normal version on the note,
                    attributed to the AI and the human who approved.
                  </Bullet>
                  <Bullet>
                    Rejected proposals stay searchable for 30 days so you can
                    diff what the model wanted to do.
                  </Bullet>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ── Expiry section ───────────────────────────────────────────────── */}
      <section
        id="expiry"
        className="scroll-mt-24 border-b border-border px-6 py-20"
      >
        <div className="mx-auto max-w-6xl">
          <SectionHeading
            eyebrow="Expiry"
            title="How long does a link stay alive?"
            description="Four presets cover every realistic use. Idle tokens die on their own; nothing lasts beyond a day. For forever access, use MCP."
          />

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30 text-left">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-3 text-overline text-muted-foreground/80"
                  >
                    Preset
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-overline text-muted-foreground/80"
                  >
                    TTL
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-overline text-muted-foreground/80"
                  >
                    Best for
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {TTL_PRESETS.map((row) => (
                  <tr key={row.preset}>
                    <td className="px-4 py-3 align-top text-foreground font-medium">
                      <span className="inline-flex items-center gap-2">
                        <Clock
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                        {row.preset}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      {row.ttl}
                      {row.kind === "sliding" && (
                        <span className="ml-2 inline-flex items-center rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Sliding
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      {row.best}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">
                Sliding window
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Every read or write extends the window by 30 minutes. An idle
                agent’s token still expires on schedule — no orphaned
                live URLs.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">Hard cap</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Pull-link tokens never live beyond 24 hours, period. If you
                need persistent access, use{" "}
                <Link href="#mcp" className="brand-underline">
                  MCP
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Security ─────────────────────────────────────────────────────── */}
      <section
        id="security"
        className="scroll-mt-24 border-b border-border bg-muted/30 px-6 py-20"
      >
        <div className="mx-auto max-w-6xl">
          <SectionHeading
            eyebrow="Security"
            title="Designed so you can revoke and forget."
            description="A pull link is a scoped, hashed, expiring credential — not a permanent share."
          />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                  <KeyRound
                    className="h-4.5 w-4.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <CardTitle className="mt-3">Hash-only at rest</CardTitle>
                <CardDescription>
                  We store an Argon2 hash of every token. The raw value is
                  shown exactly once, at creation. We can&apos;t recover it,
                  and neither can a database leak.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                  <ShieldCheck
                    className="h-4.5 w-4.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <CardTitle className="mt-3">Revoke any token instantly</CardTitle>
                <CardDescription>
                  Open{" "}
                  <Link
                    href="/app/settings/connected_apps"
                    className="brand-underline"
                  >
                    Settings → Connected apps
                  </Link>
                  , click revoke. The next request returns 401, no propagation
                  delay.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                  <Eye
                    className="h-4.5 w-4.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <CardTitle className="mt-3">Every redemption logged</CardTitle>
                <CardDescription>
                  Time, user-agent, IP, byte count, status. Visible on the
                  token detail page and exportable from the audit log.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                  <ListChecks
                    className="h-4.5 w-4.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <CardTitle className="mt-3">Read-only by default</CardTitle>
                <CardDescription>
                  Edits require an explicit “Allow edits” opt-in, and
                  even then they queue as proposals — a human approves
                  before anything saves.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle className="text-headline text-center">
                Try it: open any note and click{" "}
                <span className="brand-underline" data-active="true">
                  Send to AI
                </span>
                .
              </CardTitle>
              <CardDescription className="mx-auto mt-2 max-w-xl text-center">
                Thirty seconds from this page to a working pull link in your
                AI of choice. No credit card, no integration to write.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3 pt-2 sm:flex-row sm:justify-center">
              <Button
                size="lg"
                variant="brand"
                render={<Link href="/app" />}
              >
                Open Poggle
                <ArrowRight className="size-4" data-icon="inline-end" />
              </Button>
              <Button size="lg" variant="ghost" render={<Link href="/api" />}>
                Read the API docs
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
