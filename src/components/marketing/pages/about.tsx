import type { ReactNode } from "react";
import { Container, Section, SectionHeading } from "@/components/marketing/section";
import { MarketingShell } from "@/components/marketing/shell";

export function AboutPage(): ReactNode {
  return (
    <MarketingShell>
      <Section labelledBy="about-heading">
        <Container className="flex flex-col gap-10">
          <SectionHeading
            id="about-heading"
            kicker="About"
            title="Built because the same twenty minutes kept disappearing."
            lead="Poggle started from a specific, repeated annoyance: an agent doing good work for three hours, hitting a usage cap, and the next one having no idea any of it happened."
          />
          <div className="mk-prose t-mk-body flex max-w-[720px] flex-col gap-5 text-ink-2">
            <p>
              The workaround everyone uses is to re-explain the problem from
              memory, badly, at the start of every fresh session. It costs
              twenty minutes and it is still lossy — you remember the goal, you
              do not remember that the third approach failed for a subtle
              reason, so you watch the new agent walk into it again.
            </p>
            <p>
              None of the existing answers fit. A static instructions file
              describes the repo, not what is happening in it. The agent&apos;s
              own context dies with the process and is compacted away long
              before that. Resume flags only work within one tool, one account
              and one machine — which is precisely the boundary you are trying
              to cross.
            </p>
            <p>
              So the context has to outlive the session that produced it, be
              captured without anyone remembering to, and be served back small
              enough to actually read. That is the whole product.
            </p>
            <p>
              The opinions that follow from it are stated plainly in the
              codebase: preserve what cannot be reconstructed and drop what can;
              a brief you cannot reproduce is a brief you cannot debug; a false
              conflict is worse than a missed one. They are the useful part.
            </p>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
