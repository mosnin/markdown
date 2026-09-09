import type { ReactNode } from "react";
import { Container, Section, SectionHeading } from "@/components/marketing/section";
import { MarketingShell } from "@/components/marketing/shell";

const ENTRIES = [
  {
    version: "v1.2",
    title: "Multi-agent coordination",
    items: [
      "Check-in: one call that is heartbeat, delta fetch, claim renewal and conflict report.",
      "Advisory file claims with a TTL, so an agent killed by a usage cap cannot deadlock a project.",
      "Notices — the agent-to-agent channel, with questions that keep surfacing until answered.",
      "notice.posted and claim.conflict webhooks.",
    ],
  },
  {
    version: "v1.1",
    title: "The conversation layer",
    items: [
      "Transcript capture: reasoning stored whole, tool output cut to head and tail.",
      "Hybrid search over conversation — keyword for identifiers, vector for the paraphrase.",
      "Incremental shipping, so a live transcript is sent as deltas rather than whole.",
      "Briefs now point at the searchable conversation instead of growing.",
    ],
  },
  {
    version: "v1.0",
    title: "The relay",
    items: [
      "Projects, sessions and an append-only event log with salience scoring.",
      "Deterministic, token-budgeted handoff briefs.",
      "Hooks for Claude Code, Codex, git and anything with an HTTP client.",
      "Relay keys, MCP tools and outbound webhooks.",
    ],
  },
];

export function ChangelogPage(): ReactNode {
  return (
    <MarketingShell>
      <Section labelledBy="changelog-heading">
        <Container>
          <SectionHeading
            id="changelog-heading"
            kicker="Changelog"
            title="What changed."
          />
          <div className="mt-12 flex flex-col divide-y divide-hairline border-t border-hairline">
            {ENTRIES.map((entry) => (
              <section
                key={entry.version}
                className="grid gap-6 py-10 md:grid-cols-[260px_1fr] md:gap-12"
              >
                <div className="flex flex-col gap-2">
                  <span className="t-mk-ill-mono-11 text-ink-4">{entry.version}</span>
                  <h2 className="t-mk-h4 text-ink">{entry.title}</h2>
                </div>
                <ul className="flex flex-col gap-3">
                  {entry.items.map((item) => (
                    <li key={item} className="t-mk-body text-ink-2">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
