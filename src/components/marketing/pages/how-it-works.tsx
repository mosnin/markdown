import type { ReactNode } from "react";
import { CutButton } from "@/components/marketing/cut-button";
import {
  Container,
  Section,
  SectionHeading,
  SpecList,
} from "@/components/marketing/section";
import { MarketingShell } from "@/components/marketing/shell";

const STEPS = [
  {
    n: "1",
    title: "Create a relay key",
    body: "One per machine. The dashboard hands you the exact command to run — it is a single file in your home directory.",
    code: `mkdir -p ~/.poggle && cat > ~/.poggle/config.json <<'EOF'
{ "token": "pgr_v1_…", "api_url": "https://poggle.xyz" }
EOF`,
  },
  {
    n: "2",
    title: "Install the hooks",
    body: "Run this once inside a repo. It merges into your existing .claude/settings.json rather than replacing it, installs a git post-commit hook, and ignores its own spool.",
    code: "poggle init",
  },
  {
    n: "3",
    title: "Work normally",
    body: "Nothing else changes. Your agents run as they always did; the hooks log prompts, edits, commands, decisions and caps as they happen.",
    code: "claude   # or codex, or cursor, or your own harness",
  },
  {
    n: "4",
    title: "The next agent starts warm",
    body: "At session start the brief is fetched and injected before the agent reads a single file. You can also read it yourself.",
    code: "poggle brief",
  },
];

export function HowItWorksPage(): ReactNode {
  return (
    <MarketingShell>
      <Section labelledBy="how-heading">
        <Container>
          <SectionHeading
            id="how-heading"
            kicker="How it works"
            title="Two commands, then it is automatic."
            lead="Poggle is infrastructure, not a tool you remember to use. After setup, capture and handoff happen without anyone doing anything."
          />

          <ol className="mt-12 flex flex-col divide-y divide-hairline border-t border-hairline">
            {STEPS.map((step) => (
              <li
                key={step.n}
                className="grid gap-6 py-10 md:grid-cols-[260px_1fr] md:gap-12"
              >
                <div className="flex flex-col gap-3">
                  <span className="t-mk-ill-mono-11 text-ink-4">
                    Step {step.n}
                  </span>
                  <h2 className="t-mk-h4 text-ink">{step.title}</h2>
                </div>
                <div className="flex flex-col gap-5">
                  <p className="t-mk-body text-ink-2">{step.body}</p>
                  <pre className="overflow-x-auto rounded-8 border border-hairline bg-inset px-5 py-4">
                    <code className="t-mk-ill-mono-11 text-ink">
                      {step.code}
                    </code>
                  </pre>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      <Section className="pt-0" labelledBy="guarantees-heading">
        <Container>
          <SectionHeading
            id="guarantees-heading"
            kicker="What it will not do"
            title="A relay outage must be invisible to the person coding."
            lead="Hooks run inside your agent's own process, hundreds of times per session. That constraint shapes everything."
          />
          <SpecList
            className="mt-10"
            rows={[
              {
                term: "Never blocks",
                detail:
                  "Every call is timeout-bounded and every command exits clean. The worst acceptable outcome is a missing log entry.",
              },
              {
                term: "Never loses the last five minutes",
                detail:
                  "Events spool to disk before they are sent. The most important moment to capture is exactly when the in-flight request dies with the process.",
              },
              {
                term: "Never sends a secret",
                detail:
                  "Credentials are scrubbed on your machine before anything leaves it, and again on arrival — because the client is code we do not control once installed.",
              },
              {
                term: "Never rewrites history",
                detail:
                  "The log is append-only in the database. A leaked key could add noise; it could not change what an agent did.",
              },
            ]}
          />
          <div className="mt-12 flex flex-wrap gap-4">
            <CutButton href="/sign_in" size="lg">
              Start free
            </CutButton>
            <CutButton href="/docs" variant="outline" size="lg">
              Read the docs
            </CutButton>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
