import type { ReactNode } from "react";
import { Kicker } from "@/components/marketing/corner-plus";
import { Container } from "@/components/marketing/section";
import { MarketingShell } from "@/components/marketing/shell";

export type ContentSection = {
  title: string;
  content: ReactNode;
};

/** Legal and policy pages: a title, a dated intro, and ruled sections. */
export function ContentPage({
  title,
  intro,
  updated,
  status,
  sections,
}: {
  title: string;
  intro: string;
  updated: string;
  status?: string;
  sections: readonly ContentSection[];
}): ReactNode {
  return (
    <MarketingShell>
      <Container className="flex flex-col gap-12 pb-12 pt-12 lg:pb-12">
        <header className="flex max-w-[720px] flex-col gap-6">
          <div className="flex flex-wrap items-center gap-6">
            <Kicker>Last updated {updated}</Kicker>
            {status ? (
              <span className="t-label-caps rounded-full border border-caution-border bg-caution-wash px-4 py-1 text-caution-text">
                {status}
              </span>
            ) : null}
          </div>
          <h1 className="t-mk-hero text-balance text-ink">{title}</h1>
          <p className="t-mk-lead text-pretty text-ink-2">{intro}</p>
        </header>
        <div className="max-w-[860px] divide-y divide-hairline border-t border-hairline">
          {sections.map((section) => (
            <section
              key={section.title}
              className="grid gap-4 py-10 md:grid-cols-[260px_1fr] md:gap-12"
            >
              <h2 className="t-mk-h4 text-ink">{section.title}</h2>
              <div className="t-mk-body flex flex-col gap-5 text-ink-2 [&_a]:t-link">
                {section.content}
              </div>
            </section>
          ))}
        </div>
      </Container>
    </MarketingShell>
  );
}
