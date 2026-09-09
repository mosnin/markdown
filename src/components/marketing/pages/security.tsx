import type { ReactNode } from "react";
import { Container, Section, SectionHeading, SpecList } from "@/components/marketing/section";
import { MarketingShell } from "@/components/marketing/shell";

export function SecurityPage(): ReactNode {
  return (
    <MarketingShell>
      <Section labelledBy="security-heading">
        <Container>
          <SectionHeading
            id="security-heading"
            kicker="Security"
            title="Agent logs are the most secret-dense data a developer tool can hold."
            lead="A single tool-call hook can carry a .env file, an export AWS_SECRET line, or a stack trace with a database URL in it. That is the threat model, and it shapes the design rather than being bolted onto it."
          />
          <SpecList
            className="mt-10"
            rows={[
              {
                term: "Redacted twice",
                detail:
                  "Credentials are scrubbed on your machine before anything leaves it, and scrubbed again on arrival. Two passes because the client is code we do not control once it is installed — an old shim, a custom integration or a curl one-liner will send raw text.",
              },
              {
                term: "What is matched",
                detail:
                  "Bearer tokens, GitHub / Anthropic / OpenAI / AWS / Slack credentials, JWTs, connection-string passwords, SECRET=-style shell assignments, PEM private key blocks, and Poggle's own relay keys. Object keys that look sensitive are blanked regardless of what the value looks like.",
              },
              {
                term: "Append-only at the database",
                detail:
                  "There is no insert or update policy on the event log for signed-in users. Events arrive through a service role and no interface can rewrite them. A leaked relay key can add noise to your history; it cannot change or delete it.",
              },
              {
                term: "Scoped credentials",
                detail:
                  "A relay key reaches one workspace's session log and nothing else. Keys are stored as a prefix and a SHA-256 hash — there is no code path that can recover the secret, which is why losing one means rotating rather than looking it up.",
              },
              {
                term: "Tenant isolation",
                detail:
                  "Every read is row-level-security scoped to workspace membership. A session id from another workspace returns the same not-found as one that does not exist, so a probe learns nothing.",
              },
              {
                term: "Paths, not people",
                detail:
                  "Home directories are stripped from file paths at capture time. An absolute path leaks a username and a machine layout; a relative one does not.",
              },
              {
                term: "Bounded by construction",
                detail:
                  "Payloads are capped, redaction is depth- and length-limited so hostile input terminates, and oversized tool output is replaced with a marker rather than stored.",
              },
            ]}
          />
          <p className="t-mk-body mt-10 max-w-[720px] text-ink-2">
            Found a problem? Open an issue, or write to us — we would rather hear
            about it early than read about it later.
          </p>
        </Container>
      </Section>
    </MarketingShell>
  );
}
