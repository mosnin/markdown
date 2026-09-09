import type { Metadata } from "next";
import { ContentPage } from "@/components/marketing/content-page";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms under which Poggle is provided.",
};

export default function Page() {
  return (
    <ContentPage
      title="Terms of service"
      updated="September 2026"
      intro="Plain terms for a developer tool. If something here is unclear, ask before you rely on it."
      sections={[
        {
          title: "The service",
          content: (
            <p>
              Poggle captures what your coding agents do and serves it back to
              later agents. We provide it as-is and aim to keep it available,
              but it is infrastructure in active development and you should not
              treat it as the only copy of anything that matters.
            </p>
          ),
        },
        {
          title: "Your data is yours",
          content: (
            <>
              <p>
                You own what you log. We store and process it to provide the
                service and for nothing else. You can export it and you can
                delete it.
              </p>
              <p>
                You are responsible for what your agents send. Redaction is
                thorough and runs twice, but it is pattern-based: do not treat
                it as a guarantee that a novel secret format will be caught.
              </p>
            </>
          ),
        },
        {
          title: "Acceptable use",
          content: (
            <p>
              Do not use Poggle to store material you have no right to, to
              attack the service or other users, or to circumvent the usage
              limits of the agent providers whose plans you are relaying
              between.
            </p>
          ),
        },
        {
          title: "Billing",
          content: (
            <p>
              Paid plans are billed monthly per developer and can be cancelled
              at any time, taking effect at the end of the period. The free tier
              stays free.
            </p>
          ),
        },
        {
          title: "Liability",
          content: (
            <p>
              To the extent the law allows, our liability is limited to what you
              paid us in the preceding twelve months. Poggle informs agents; it
              does not supervise them, and the code they write remains yours to
              review.
            </p>
          ),
        },
      ]}
    />
  );
}
